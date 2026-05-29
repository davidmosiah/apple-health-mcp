import { createReadStream, promises as fs } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import sax from "sax";
import yauzl from "yauzl";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import type { AppleHealthRecord, AppleHealthWorkout, AppleHealthWorkoutEvent } from "../types.js";
import { parseFlexibleDate } from "./time.js";
import {
  getLastParsedAt,
  invalidateIfExportChanged,
  loadCache,
  saveCache
} from "./incremental-cache.js";

export interface ExportLocation {
  input_path?: string;
  resolved_path?: string;
  export_xml_path?: string;
  exists: boolean;
  kind: "missing" | "xml" | "directory" | "zip" | "unsupported";
  size_bytes?: number;
  modified_at?: string;
  mtime_ms?: number;
  note?: string;
}

export interface RecordQuery {
  exportPath?: string;
  type?: string;
  start?: string;
  end?: string;
  limit?: number;
  /**
   * When true, skip records older than the per-category last-parsed timestamp
   * in the incremental cache and persist the newest seen timestamp back. The
   * cache auto-invalidates when the export file mtime changes.
   */
  useIncrementalCache?: boolean;
}

export interface WorkoutQuery {
  exportPath?: string;
  start?: string;
  end?: string;
  limit?: number;
}

export interface SnapshotQuery {
  exportPath?: string;
  start?: string;
  end?: string;
}

export interface AppleHealthSnapshot {
  source: "apple_health_export";
  generated_at: string;
  location: ExportLocation;
  range: {
    start?: string;
    end?: string;
  };
  cache: {
    key: string;
    hit: boolean;
  };
  records: AppleHealthRecord[];
  workouts: AppleHealthWorkout[];
}

const SNAPSHOT_CACHE = new Map<string, AppleHealthSnapshot>();
const MAX_SNAPSHOT_CACHE_ENTRIES = 6;

export async function inspectExportLocation(inputPath?: string): Promise<ExportLocation> {
  if (!inputPath) {
    return {
      exists: false,
      kind: "missing",
      note: "Set APPLE_HEALTH_EXPORT_PATH or run setup with --export-path."
    };
  }

  const resolvedPath = resolve(inputPath.replace(/^~/, process.env.HOME ?? ""));
  try {
    const stat = await fs.stat(resolvedPath);
    if (stat.isDirectory()) {
      const candidates = [
        join(resolvedPath, "apple_health_export", "export.xml"),
        join(resolvedPath, "export.xml")
      ];
      for (const candidate of candidates) {
        try {
          const candidateStat = await fs.stat(candidate);
          if (candidateStat.isFile()) {
            return {
              input_path: inputPath,
              resolved_path: resolvedPath,
              export_xml_path: candidate,
              exists: true,
              kind: "directory",
              size_bytes: candidateStat.size,
              modified_at: candidateStat.mtime.toISOString(),
              mtime_ms: candidateStat.mtimeMs
            };
          }
        } catch {
          // Try next candidate.
        }
      }
      return {
        input_path: inputPath,
        resolved_path: resolvedPath,
        exists: false,
        kind: "directory",
        note: "Directory exists, but export.xml was not found."
      };
    }
    if (stat.isFile() && basename(resolvedPath) === "export.xml") {
      return {
        input_path: inputPath,
        resolved_path: resolvedPath,
        export_xml_path: resolvedPath,
        exists: true,
        kind: "xml",
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        mtime_ms: stat.mtimeMs
      };
    }
    if (stat.isFile() && extname(resolvedPath).toLowerCase() === ".zip") {
      return {
        input_path: inputPath,
        resolved_path: resolvedPath,
        exists: true,
        kind: "zip",
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
        mtime_ms: stat.mtimeMs,
        note: "Will read apple_health_export/export.xml from the zip."
      };
    }
    return {
      input_path: inputPath,
      resolved_path: resolvedPath,
      exists: false,
      kind: "unsupported",
      size_bytes: stat.size,
      note: "Expected export.xml, an Apple Health export directory, or export.zip."
    };
  } catch {
    return {
      input_path: inputPath,
      resolved_path: resolvedPath,
      exists: false,
      kind: "missing",
      note: "Path does not exist."
    };
  }
}

export async function listRecords(query: RecordQuery): Promise<AppleHealthRecord[]> {
  const limit = normalizeLimit(query.limit);
  const location = await inspectExportLocation(query.exportPath);
  if (!location.exists) throw new Error(location.note ?? "Apple Health export not found.");
  const start = query.start ? parseAppleDate(query.start) : undefined;
  const end = query.end ? parseAppleDate(query.end) : undefined;
  const records: AppleHealthRecord[] = [];

  let incrementalCutoff: Date | undefined;
  let useIncremental = false;
  const cachePath = location.resolved_path ?? location.export_xml_path ?? location.input_path;
  if (query.useIncrementalCache && query.type && cachePath) {
    useIncremental = true;
    await invalidateIfExportChanged(cachePath, location.mtime_ms);
    const cached = await getLastParsedAt(query.type);
    if (cached) {
      const parsed = parseAppleDate(cached);
      if (parsed) incrementalCutoff = parsed;
    }
  }

  let newestSeenMs = 0;
  await parseExportEntities(location, {
    onRecord(record) {
      if (query.type && record.type !== query.type) return false;
      if (!overlaps(record.startDate, record.endDate, start, end)) return false;
      if (incrementalCutoff) {
        const recordStart = parseAppleDate(record.startDate);
        if (recordStart && recordStart <= incrementalCutoff) return false;
      }
      if (useIncremental) {
        const ts = parseAppleDate(record.startDate);
        if (ts && ts.getTime() > newestSeenMs) newestSeenMs = ts.getTime();
      }
      records.push(record);
      return records.length >= limit;
    }
  });

  if (useIncremental && query.type && newestSeenMs > 0 && cachePath) {
    const cache = await loadCache();
    cache.export_path = cachePath;
    cache.export_mtime_ms = location.mtime_ms;
    cache.categories[query.type] = new Date(newestSeenMs).toISOString();
    await saveCache(cache);
  }

  return records;
}

export async function listWorkouts(query: WorkoutQuery): Promise<AppleHealthWorkout[]> {
  const limit = normalizeLimit(query.limit);
  const location = await inspectExportLocation(query.exportPath);
  if (!location.exists) throw new Error(location.note ?? "Apple Health export not found.");
  const start = query.start ? parseAppleDate(query.start) : undefined;
  const end = query.end ? parseAppleDate(query.end) : undefined;
  const workouts: AppleHealthWorkout[] = [];

  await parseExportEntities(location, {
    onWorkout(workout) {
      if (!overlaps(workout.startDate, workout.endDate, start, end)) return false;
      workouts.push(workout);
      return workouts.length >= limit;
    }
  });

  return workouts;
}

export async function getExportSnapshot(query: SnapshotQuery): Promise<AppleHealthSnapshot> {
  const location = await inspectExportLocation(query.exportPath);
  if (!location.exists) throw new Error(location.note ?? "Apple Health export not found.");
  const start = query.start ? parseAppleDate(query.start) : undefined;
  const end = query.end ? parseAppleDate(query.end) : undefined;
  const key = snapshotCacheKey(location, query);
  const cached = SNAPSHOT_CACHE.get(key);
  if (cached) return { ...cached, cache: { ...cached.cache, hit: true } };

  const records: AppleHealthRecord[] = [];
  const workouts: AppleHealthWorkout[] = [];
  await parseExportEntities(location, {
    onRecord(record) {
      if (!overlaps(record.startDate, record.endDate, start, end)) return false;
      records.push(record);
      return false;
    },
    onWorkout(workout) {
      if (!overlaps(workout.startDate, workout.endDate, start, end)) return false;
      workouts.push(workout);
      return false;
    }
  });

  const snapshot: AppleHealthSnapshot = {
    source: "apple_health_export",
    generated_at: new Date().toISOString(),
    location,
    range: {
      start: query.start,
      end: query.end
    },
    cache: {
      key,
      hit: false
    },
    records,
    workouts
  };
  cacheSnapshot(key, snapshot);
  return snapshot;
}

export function parseAppleDate(value: string | undefined): Date | undefined {
  return parseFlexibleDate(value);
}

function normalizeLimit(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

function normalizeRecord(attributes: Record<string, unknown>): AppleHealthRecord {
  const record: AppleHealthRecord = {
    type: String(attributes.type ?? ""),
    sourceName: optionalString(attributes.sourceName),
    unit: optionalString(attributes.unit),
    value: optionalString(attributes.value),
    creationDate: optionalString(attributes.creationDate),
    startDate: optionalString(attributes.startDate),
    endDate: optionalString(attributes.endDate)
  };
  const numeric = Number(record.value);
  if (Number.isFinite(numeric)) record.numeric_value = numeric;
  return record;
}

function normalizeWorkout(attributes: Record<string, unknown>): AppleHealthWorkout {
  return {
    workoutActivityType: String(attributes.workoutActivityType ?? ""),
    sourceName: optionalString(attributes.sourceName),
    creationDate: optionalString(attributes.creationDate),
    startDate: optionalString(attributes.startDate),
    endDate: optionalString(attributes.endDate),
    duration: optionalNumber(attributes.duration),
    durationUnit: optionalString(attributes.durationUnit),
    totalDistance: optionalNumber(attributes.totalDistance),
    totalDistanceUnit: optionalString(attributes.totalDistanceUnit),
    totalEnergyBurned: optionalNumber(attributes.totalEnergyBurned),
    totalEnergyBurnedUnit: optionalString(attributes.totalEnergyBurnedUnit)
  };
}

function normalizeWorkoutEvent(attributes: Record<string, unknown>): AppleHealthWorkoutEvent {
  return {
    type: optionalString(attributes.type),
    date: optionalString(attributes.date),
    duration: optionalNumber(attributes.duration),
    durationUnit: optionalString(attributes.durationUnit)
  };
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function overlaps(startValue: string | undefined, endValue: string | undefined, start?: Date, end?: Date): boolean {
  if (!start && !end) return true;
  const itemStart = parseAppleDate(startValue);
  const itemEnd = parseAppleDate(endValue) ?? itemStart;
  if (!itemStart && !itemEnd) return false;
  if (start && itemEnd && itemEnd < start) return false;
  if (end && itemStart && itemStart > end) return false;
  return true;
}

export function recordOverlaps(startValue: string | undefined, endValue: string | undefined, start?: Date, end?: Date): boolean {
  return overlaps(startValue, endValue, start, end);
}

interface EntityVisitor {
  onRecord?: (record: AppleHealthRecord) => boolean;
  onWorkout?: (workout: AppleHealthWorkout) => boolean;
}

async function parseExportEntities(location: ExportLocation, visitor: EntityVisitor): Promise<void> {
  const stream = await openXmlStream(location);
  await new Promise<void>((resolvePromise, reject) => {
    const parser = sax.createStream(true, { trim: false, lowercase: false });
    let stopped = false;
    let currentRecord: AppleHealthRecord | undefined;
    let currentWorkout: AppleHealthWorkout | undefined;

    parser.on("opentag", (node) => {
      if (stopped) return;
      const attributes = node.attributes as Record<string, unknown>;
      if (node.name === "Record") {
        currentRecord = normalizeRecord(attributes);
        return;
      }
      if (node.name === "Workout") {
        currentWorkout = normalizeWorkout(attributes);
        return;
      }
      if (node.name === "MetadataEntry") {
        addMetadata(currentRecord ?? currentWorkout, attributes);
        return;
      }
      if (node.name === "WorkoutEvent" && currentWorkout) {
        currentWorkout.events = currentWorkout.events ?? [];
        currentWorkout.events.push(normalizeWorkoutEvent(attributes));
      }
    });
    parser.on("closetag", (name) => {
      if (stopped) return;
      let shouldStop = false;
      if (name === "Record" && currentRecord) {
        shouldStop = visitor.onRecord?.(currentRecord) ?? false;
        currentRecord = undefined;
      } else if (name === "Workout" && currentWorkout) {
        shouldStop = visitor.onWorkout?.(currentWorkout) ?? false;
        currentWorkout = undefined;
      }
      if (shouldStop) {
        stopped = true;
        stream.destroy();
        resolvePromise();
      }
    });
    parser.on("error", (error) => {
      reject(error);
    });
    parser.on("end", () => {
      resolvePromise();
    });
    stream.on("error", reject);
    stream.pipe(parser);
  });
}

function addMetadata(entity: AppleHealthRecord | AppleHealthWorkout | undefined, attributes: Record<string, unknown>): void {
  if (!entity) return;
  const key = optionalString(attributes.key);
  const value = optionalString(attributes.value);
  if (!key || value === undefined) return;
  entity.metadata = entity.metadata ?? {};
  entity.metadata[key] = value;
}

function snapshotCacheKey(location: ExportLocation, query: SnapshotQuery): string {
  return [
    location.resolved_path ?? location.export_xml_path ?? location.input_path ?? "unknown",
    location.size_bytes ?? 0,
    location.mtime_ms ?? 0,
    query.start ?? "",
    query.end ?? ""
  ].join("|");
}

function cacheSnapshot(key: string, snapshot: AppleHealthSnapshot): void {
  SNAPSHOT_CACHE.set(key, snapshot);
  while (SNAPSHOT_CACHE.size > MAX_SNAPSHOT_CACHE_ENTRIES) {
    const oldest = SNAPSHOT_CACHE.keys().next().value;
    if (!oldest) break;
    SNAPSHOT_CACHE.delete(oldest);
  }
}

/**
 * Drop the in-memory snapshot cache so the next summary/inventory call re-parses
 * the export from disk. Call this after a reimport/promotion of a fresh export so
 * long-running transports (HTTP) immediately reflect the new data. Stdio one-shot
 * processes do not need this, but it is harmless there.
 */
export function clearSnapshotCache(): void {
  SNAPSHOT_CACHE.clear();
}

async function openXmlStream(location: ExportLocation): Promise<Readable> {
  if (location.kind === "xml" || location.kind === "directory") {
    const path = location.export_xml_path ?? location.resolved_path;
    if (!path) throw new Error("Apple Health export.xml path could not be resolved.");
    return createReadStream(path);
  }
  if (location.kind === "zip" && location.resolved_path) {
    return openZipExportStream(location.resolved_path);
  }
  throw new Error(location.note ?? "Unsupported Apple Health export location.");
}

function openZipExportStream(zipPath: string): Promise<Readable> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipfile) => {
      if (openError || !zipfile) {
        reject(openError ?? new Error("Unable to open Apple Health export zip."));
        return;
      }
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        const name = entry.fileName.replace(/\\/g, "/");
        if (/apple_health_export\/export\.xml$/.test(name) || name === "export.xml") {
          zipfile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              zipfile.close();
              reject(streamError ?? new Error("Unable to read export.xml from zip."));
              return;
            }
            stream.on("end", () => zipfile.close());
            stream.on("close", () => zipfile.close());
            resolvePromise(stream);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on("end", () => {
        zipfile.close();
        reject(new Error("export.xml was not found inside Apple Health export zip."));
      });
      zipfile.on("error", reject);
    });
  });
}

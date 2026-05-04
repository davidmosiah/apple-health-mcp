import { createReadStream, promises as fs } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import sax from "sax";
import yauzl from "yauzl";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import type { AppleHealthRecord, AppleHealthWorkout } from "../types.js";

export interface ExportLocation {
  input_path?: string;
  resolved_path?: string;
  export_xml_path?: string;
  exists: boolean;
  kind: "missing" | "xml" | "directory" | "zip" | "unsupported";
  size_bytes?: number;
  note?: string;
}

export interface RecordQuery {
  exportPath?: string;
  type?: string;
  start?: string;
  end?: string;
  limit?: number;
}

export interface WorkoutQuery {
  exportPath?: string;
  start?: string;
  end?: string;
  limit?: number;
}

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
              size_bytes: candidateStat.size
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
        size_bytes: stat.size
      };
    }
    if (stat.isFile() && extname(resolvedPath).toLowerCase() === ".zip") {
      return {
        input_path: inputPath,
        resolved_path: resolvedPath,
        exists: true,
        kind: "zip",
        size_bytes: stat.size,
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

  await parseExport(location, (name, attributes) => {
    if (name !== "Record") return false;
    const record = normalizeRecord(attributes);
    if (query.type && record.type !== query.type) return false;
    if (!overlaps(record.startDate, record.endDate, start, end)) return false;
    records.push(record);
    return records.length >= limit;
  });

  return records;
}

export async function listWorkouts(query: WorkoutQuery): Promise<AppleHealthWorkout[]> {
  const limit = normalizeLimit(query.limit);
  const location = await inspectExportLocation(query.exportPath);
  if (!location.exists) throw new Error(location.note ?? "Apple Health export not found.");
  const start = query.start ? parseAppleDate(query.start) : undefined;
  const end = query.end ? parseAppleDate(query.end) : undefined;
  const workouts: AppleHealthWorkout[] = [];

  await parseExport(location, (name, attributes) => {
    if (name !== "Workout") return false;
    const workout = normalizeWorkout(attributes);
    if (!overlaps(workout.startDate, workout.endDate, start, end)) return false;
    workouts.push(workout);
    return workouts.length >= limit;
  });

  return workouts;
}

export function dayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return { start, end };
}

export function parseAppleDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const appleMatch = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value);
  if (appleMatch) {
    const parsed = new Date(`${appleMatch[1]}T${appleMatch[2]}${appleMatch[3]}:${appleMatch[4]}`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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

async function parseExport(location: ExportLocation, onElement: (name: string, attributes: Record<string, unknown>) => boolean): Promise<void> {
  const stream = await openXmlStream(location);
  await new Promise<void>((resolvePromise, reject) => {
    const parser = sax.createStream(true, { trim: false, lowercase: false });
    let stopped = false;

    parser.on("opentag", (node) => {
      if (stopped) return;
      const shouldStop = onElement(node.name, node.attributes as Record<string, unknown>);
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

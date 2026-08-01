import type { AppleHealthRecord, AppleHealthWorkout, PrivacyMode } from "../types.js";
import { dateOnlyInTimezone, parseFlexibleDate } from "./time.js";

export interface RecordAggregateResult {
  count_by_type: Record<string, number>;
  units: string[];
  date_range?: {
    first: string;
    last: string;
    first_date?: string;
    last_date?: string;
  };
  numeric?: {
    count: number;
    sum?: number;
    average?: number;
    min?: number;
    max?: number;
  };
}

/**
 * Streaming aggregator. It exists so callers can accumulate over every record that
 * matches a query while keeping only a bounded page of records in memory: an
 * aggregate computed from a page that was capped by `limit` is not the aggregate of
 * the queried set, and reporting it as one produces wrong minimums/maximums.
 * It also avoids Math.min(...values), which throws RangeError past ~120k values.
 */
export interface RecordAggregator {
  add(record: AppleHealthRecord): void;
  finish(timezone?: string): RecordAggregateResult;
}

export function createRecordAggregator(): RecordAggregator {
  const countByType = new Map<string, number>();
  const units = new Set<string>();
  let earliestMs: number | undefined;
  let latestMs: number | undefined;
  let numericCount = 0;
  let numericSum = 0;
  let numericMin: number | undefined;
  let numericMax: number | undefined;

  return {
    add(record: AppleHealthRecord) {
      const type = record.type || "unknown";
      countByType.set(type, (countByType.get(type) ?? 0) + 1);
      if (record.unit) units.add(record.unit);
      for (const value of [record.startDate, record.endDate]) {
        const parsed = parseFlexibleDate(value);
        if (!parsed) continue;
        const ms = parsed.getTime();
        if (earliestMs === undefined || ms < earliestMs) earliestMs = ms;
        if (latestMs === undefined || ms > latestMs) latestMs = ms;
      }
      const numeric = record.numeric_value;
      if (numeric !== undefined) {
        numericCount += 1;
        numericSum += numeric;
        if (numericMin === undefined || numeric < numericMin) numericMin = numeric;
        if (numericMax === undefined || numeric > numericMax) numericMax = numeric;
      }
    },
    finish(timezone = "UTC"): RecordAggregateResult {
      return {
        count_by_type: Object.fromEntries([...countByType].sort(([left], [right]) => left.localeCompare(right))),
        units: [...units].sort(),
        date_range: earliestMs === undefined || latestMs === undefined
          ? undefined
          : buildDateRange(new Date(earliestMs), new Date(latestMs), timezone),
        numeric: numericCount
          ? {
              count: numericCount,
              sum: round(numericSum),
              average: round(numericSum / numericCount),
              min: round(numericMin),
              max: round(numericMax)
            }
          : undefined
      };
    }
  };
}

export function recordPrivacyView(
  records: AppleHealthRecord[],
  mode: PrivacyMode,
  timezone = "UTC",
  /**
   * Aggregate computed over every record matching the query, not only the ones that
   * survived `limit`. When omitted, the aggregate falls back to the records passed in
   * and says so via `aggregate_scope`.
   */
  fullSetAggregate?: RecordAggregateResult
) {
  if (mode === "raw") {
    return {
      records,
      disclosure: "raw_export_record_attributes_returned"
    };
  }

  if (mode === "structured") {
    return {
      records: records.map((record) => ({
        type: record.type,
        unit: record.unit,
        value: record.numeric_value ?? record.value,
        numeric_value: record.numeric_value,
        start_date: dateOnlyInTimezone(record.startDate, timezone),
        end_date: dateOnlyInTimezone(record.endDate, timezone),
        metadata_keys: record.metadata ? Object.keys(record.metadata).sort() : undefined
      })),
      disclosure: "structured_fields_without_creation_dates_source_names_or_raw_metadata"
    };
  }

  return {
    records: [],
    aggregate: fullSetAggregate ?? recordAggregate(records, timezone),
    aggregate_scope: fullSetAggregate ? "all_matching_records" : "provided_records_only",
    disclosure: fullSetAggregate
      ? "summary_mode_omits_individual_records_aggregate_covers_all_matching_records"
      : "summary_mode_omits_individual_records"
  };
}

export function workoutPrivacyView(workouts: AppleHealthWorkout[], mode: PrivacyMode, timezone = "UTC") {
  if (mode === "raw") {
    return {
      workouts,
      disclosure: "raw_export_workout_attributes_returned"
    };
  }

  if (mode === "structured") {
    return {
      workouts: workouts.map((workout) => ({
        workoutActivityType: workout.workoutActivityType,
        start_date: dateOnlyInTimezone(workout.startDate, timezone),
        end_date: dateOnlyInTimezone(workout.endDate, timezone),
        duration: workout.duration,
        durationUnit: workout.durationUnit,
        totalDistance: workout.totalDistance,
        totalDistanceUnit: workout.totalDistanceUnit,
        totalEnergyBurned: workout.totalEnergyBurned,
        totalEnergyBurnedUnit: workout.totalEnergyBurnedUnit,
        metadata_keys: workout.metadata ? Object.keys(workout.metadata).sort() : undefined,
        event_count: workout.events?.length
      })),
      disclosure: "structured_fields_without_creation_dates_source_names_or_raw_metadata"
    };
  }

  return {
    workouts: [],
    aggregate: workoutAggregate(workouts, timezone),
    disclosure: "summary_mode_omits_individual_workouts"
  };
}

/**
 * Aggregate over exactly the records handed in. Callers that applied a `limit` must
 * NOT use this to describe the queried set — use a RecordAggregator fed by the full
 * scan instead (see createRecordAggregator).
 */
export function recordAggregate(records: AppleHealthRecord[], timezone = "UTC"): RecordAggregateResult {
  const aggregator = createRecordAggregator();
  for (const record of records) aggregator.add(record);
  return aggregator.finish(timezone);
}

export function workoutAggregate(workouts: AppleHealthWorkout[], timezone = "UTC") {
  return {
    count_by_activity: countBy(workouts, (workout) => workout.workoutActivityType || "unknown"),
    date_range: dateRange(workouts.flatMap((workout) => [workout.startDate, workout.endDate]), timezone),
    total_duration_minutes: round(workouts.reduce((sum, workout) => sum + durationMinutes(workout), 0)),
    total_distance: round(workouts.reduce((sum, workout) => sum + (workout.totalDistance ?? 0), 0)),
    distance_units: Array.from(new Set(workouts.map((workout) => workout.totalDistanceUnit).filter((unit): unit is string => Boolean(unit)))).sort(),
    total_energy_kcal: round(workouts.reduce((sum, workout) => sum + (workout.totalEnergyBurned ?? 0), 0))
  };
}

export function dateRange(values: Array<string | undefined>, timezone = "UTC") {
  const dates = values
    .map((value) => parseFlexibleDate(value))
    .filter((date): date is Date => Boolean(date))
    .sort((left, right) => left.getTime() - right.getTime());
  if (!dates.length) return undefined;
  return buildDateRange(dates[0], dates[dates.length - 1], timezone);
}

function buildDateRange(first: Date, last: Date, timezone: string) {
  return {
    first: first.toISOString(),
    last: last.toISOString(),
    first_date: dateOnlyInTimezone(first.toISOString(), timezone),
    last_date: dateOnlyInTimezone(last.toISOString(), timezone)
  };
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  return Object.fromEntries(
    [...items.reduce((map, item) => {
      const key = getKey(item);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right))
  );
}

function durationMinutes(workout: AppleHealthWorkout): number {
  if (!workout.duration) return 0;
  if (workout.durationUnit === "sec") return workout.duration / 60;
  if (workout.durationUnit === "hr") return workout.duration * 60;
  return workout.duration;
}

function round(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100) / 100;
}

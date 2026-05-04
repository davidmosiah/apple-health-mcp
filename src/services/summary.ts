import type { AppleHealthRecord } from "../types.js";
import { dayBounds, listRecords, listWorkouts, parseAppleDate } from "./apple-health-export.js";

export async function buildDailySummary(exportPath: string | undefined, date = todayIsoDate()) {
  const { start, end } = dayBounds(date);
  const records = await listRecords({ exportPath, start: start.toISOString(), end: end.toISOString(), limit: 500 });
  const workouts = await listWorkouts({ exportPath, start: start.toISOString(), end: end.toISOString(), limit: 500 });
  const steps = sumType(records, "HKQuantityTypeIdentifierStepCount");
  const activeEnergy = sumType(records, "HKQuantityTypeIdentifierActiveEnergyBurned");
  const distance = sumType(records, "HKQuantityTypeIdentifierDistanceWalkingRunning");
  const resting = averageType(records, "HKQuantityTypeIdentifierRestingHeartRate");
  const hrv = averageType(records, "HKQuantityTypeIdentifierHeartRateVariabilitySDNN");
  const heartRate = averageType(records, "HKQuantityTypeIdentifierHeartRate");
  const sleepMinutes = sleepMinutesAsleep(records);

  return {
    kind: "daily_summary",
    date,
    generated_at: new Date().toISOString(),
    source: "apple_health_export",
    totals: {
      steps,
      active_energy_kcal: activeEnergy,
      distance: distance || undefined
    },
    heart: {
      average_bpm: round(heartRate),
      resting_bpm: round(resting),
      hrv_sdnn_ms: round(hrv)
    },
    sleep: {
      minutes_asleep: sleepMinutes,
      hours_asleep: round(sleepMinutes / 60)
    },
    workouts: {
      count: workouts.length,
      total_duration_minutes: round(workouts.reduce((sum, workout) => sum + (workout.duration ?? 0), 0)),
      records: workouts
    },
    notes: [
      "Summary is derived from an Apple Health export file, not live HealthKit.",
      "This is wellness context, not medical diagnosis."
    ]
  };
}

export async function buildWeeklySummary(exportPath: string | undefined, endDate = todayIsoDate(), days = 7) {
  const normalizedDays = Math.min(Math.max(Math.trunc(days), 1), 30);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const summaries = [];
  for (let offset = normalizedDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    summaries.push(await buildDailySummary(exportPath, date.toISOString().slice(0, 10)));
  }

  const totals = {
    steps: summaries.reduce((sum, item) => sum + item.totals.steps, 0),
    active_energy_kcal: summaries.reduce((sum, item) => sum + (item.totals.active_energy_kcal ?? 0), 0),
    workouts: summaries.reduce((sum, item) => sum + item.workouts.count, 0),
    sleep_minutes: summaries.reduce((sum, item) => sum + item.sleep.minutes_asleep, 0)
  };

  return {
    kind: "weekly_summary",
    end_date: endDate,
    days: normalizedDays,
    generated_at: new Date().toISOString(),
    source: "apple_health_export",
    totals,
    averages: {
      steps_per_day: round(totals.steps / normalizedDays),
      sleep_hours_per_day: round(totals.sleep_minutes / normalizedDays / 60)
    },
    daily: summaries,
    notes: [
      "Summary is derived from an Apple Health export file, not live HealthKit.",
      "This is wellness context, not medical diagnosis."
    ]
  };
}

export function formatSummaryMarkdown(summary: Record<string, unknown>): string {
  const lines = [`# Apple Health ${summary.kind === "weekly_summary" ? "Weekly" : "Daily"} Summary`, ""];
  for (const [key, value] of Object.entries(summary)) {
    if (key === "daily" || key === "workouts") continue;
    lines.push(`- **${key}**: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  }
  return lines.join("\n");
}

function sumType(records: AppleHealthRecord[], type: string): number {
  return round(records.filter((record) => record.type === type).reduce((sum, record) => sum + (record.numeric_value ?? 0), 0)) ?? 0;
}

function averageType(records: AppleHealthRecord[], type: string): number | undefined {
  const values = records.filter((record) => record.type === type && record.numeric_value !== undefined).map((record) => record.numeric_value as number);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sleepMinutesAsleep(records: AppleHealthRecord[]): number {
  return round(records
    .filter((record) => record.type === "HKCategoryTypeIdentifierSleepAnalysis" && /Asleep/i.test(record.value ?? ""))
    .reduce((sum, record) => {
      const start = parseAppleDate(record.startDate);
      const end = parseAppleDate(record.endDate);
      if (!start || !end) return sum;
      return sum + Math.max(0, end.getTime() - start.getTime()) / 60000;
    }, 0)) ?? 0;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function round(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100) / 100;
}

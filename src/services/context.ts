import { buildDailySummary } from "./summary.js";

type ContextOptions = {
  date?: string;
  soreness?: string[];
  injury_flags?: string[];
  notes?: string;
};

function loadFromWorkouts(workouts: number, steps: number): "low" | "normal" | "high" | "unknown" {
  if (!workouts && !steps) return "unknown";
  if (workouts >= 2 || steps >= 15000) return "high";
  if (workouts === 0 && steps <= 3000) return "low";
  return "normal";
}

function sleepScoreFromHours(hours: number | undefined): number | undefined {
  if (hours === undefined) return undefined;
  return Math.max(0, Math.min(100, Math.round((hours / 7) * 100)));
}

export async function buildWellnessContext(exportPath: string | undefined, options: ContextOptions) {
  const summary = await buildDailySummary(exportPath, options.date);
  const sleepScore = sleepScoreFromHours(summary.sleep.hours_asleep);
  const recentTrainingLoad = loadFromWorkouts(summary.workouts.count, summary.totals.steps);

  return {
    source: "apple_health",
    generated_at: summary.generated_at,
    sleep_score: sleepScore,
    recent_training_load: recentTrainingLoad,
    soreness: options.soreness ?? [],
    injury_flags: options.injury_flags ?? [],
    notes: [
      "Derived from Apple Health export data, not live HealthKit.",
      options.notes
    ].filter((note): note is string => Boolean(note)),
    data_quality: {
      confidence: "export",
      source: summary.source
    },
    telegram_summary: [
      "Apple Health wellness context",
      sleepScore !== undefined ? `Sleep: ${sleepScore}` : undefined,
      `Load: ${recentTrainingLoad}`
    ].filter(Boolean).join(" | ")
  };
}

export function formatWellnessContextMarkdown(context: Record<string, unknown>): string {
  return ["# Apple Health Wellness Context", "", JSON.stringify(context, null, 2)].join("\n");
}

export type ResponseFormat = "markdown" | "json";
export type PrivacyMode = "summary" | "structured" | "raw";

export interface ToolResponse<T> extends Record<string, unknown> {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: T;
  isError?: boolean;
}

export interface AppleHealthConfig {
  exportPath?: string;
  privacyMode: PrivacyMode;
  timezone?: string;
  lastImportAt?: string;
  lastImportSourcePath?: string;
  /** Folder watched for new Apple Health exports (auto-reimport source). */
  watchPath?: string;
  /** Path of the export most recently promoted from the watch folder. */
  lastWatchImportPath?: string;
  /** ISO timestamp of the last successful watch-folder reimport. */
  lastWatchImportAt?: string;
}

export interface AppleHealthRecord {
  type: string;
  sourceName?: string;
  unit?: string;
  value?: string;
  numeric_value?: number;
  creationDate?: string;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, string>;
}

export interface AppleHealthWorkout {
  workoutActivityType: string;
  sourceName?: string;
  creationDate?: string;
  startDate?: string;
  endDate?: string;
  duration?: number;
  durationUnit?: string;
  totalDistance?: number;
  totalDistanceUnit?: string;
  totalEnergyBurned?: number;
  totalEnergyBurnedUnit?: string;
  metadata?: Record<string, string>;
  events?: AppleHealthWorkoutEvent[];
}

export interface AppleHealthWorkoutEvent {
  type?: string;
  date?: string;
  duration?: number;
  durationUnit?: string;
}

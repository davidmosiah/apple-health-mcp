import { homedir } from "node:os";
import type { AppleHealthConfig, PrivacyMode } from "../types.js";
import { readLocalConfig } from "./local-config.js";

export function getConfig(env: NodeJS.ProcessEnv = process.env, homeDir = homedir()): AppleHealthConfig {
  const local = readLocalConfig(homeDir);
  return {
    exportPath: env.APPLE_HEALTH_EXPORT_PATH ?? local.APPLE_HEALTH_EXPORT_PATH,
    privacyMode: parsePrivacyMode(env.APPLE_HEALTH_PRIVACY_MODE ?? local.APPLE_HEALTH_PRIVACY_MODE),
    timezone: env.APPLE_HEALTH_TIMEZONE ?? local.APPLE_HEALTH_TIMEZONE ?? process.env.TZ ?? "UTC",
    lastImportAt: local.APPLE_HEALTH_LAST_IMPORT_AT,
    lastImportSourcePath: local.APPLE_HEALTH_LAST_IMPORT_SOURCE_PATH
  };
}

export function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "summary";
}

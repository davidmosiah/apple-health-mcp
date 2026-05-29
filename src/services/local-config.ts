import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PrivacyMode } from "../types.js";

export interface LocalAppleHealthConfig {
  APPLE_HEALTH_EXPORT_PATH?: string;
  APPLE_HEALTH_PRIVACY_MODE?: PrivacyMode;
  APPLE_HEALTH_TIMEZONE?: string;
  APPLE_HEALTH_LAST_IMPORT_AT?: string;
  APPLE_HEALTH_LAST_IMPORT_SOURCE_PATH?: string;
  /** Folder watched for new Apple Health exports (auto-reimport source). */
  APPLE_HEALTH_WATCH_PATH?: string;
  /** Path of the export most recently promoted from the watch folder. */
  APPLE_HEALTH_LAST_WATCH_IMPORT_PATH?: string;
  /** ISO timestamp of the last successful watch-folder reimport. */
  APPLE_HEALTH_LAST_WATCH_IMPORT_AT?: string;
}

export function localConfigPath(homeDir = homedir()): string {
  return join(homeDir, ".apple-health-mcp", "config.json");
}

export function readLocalConfig(homeDir = homedir()): LocalAppleHealthConfig {
  const path = localConfigPath(homeDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LocalAppleHealthConfig;
  } catch {
    return {};
  }
}

export function writeLocalConfig(config: LocalAppleHealthConfig, homeDir = homedir()): string {
  const path = localConfigPath(homeDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/**
 * Merge a partial patch into the existing local config, preserving any
 * unrelated fields already on disk. `undefined` values in the patch are
 * ignored so callers can pass a sparse update without clobbering state.
 */
export function mergeLocalConfig(patch: Partial<LocalAppleHealthConfig>, homeDir = homedir()): string {
  const existing = readLocalConfig(homeDir);
  const next: LocalAppleHealthConfig = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return writeLocalConfig(next, homeDir);
}

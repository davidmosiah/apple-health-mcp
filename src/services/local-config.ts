import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PrivacyMode } from "../types.js";

export interface LocalAppleHealthConfig {
  APPLE_HEALTH_EXPORT_PATH?: string;
  APPLE_HEALTH_PRIVACY_MODE?: PrivacyMode;
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

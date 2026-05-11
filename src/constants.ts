export const SERVER_NAME = "apple-health-mcp-server";
export const SERVER_VERSION = "0.4.1";
export const NPM_PACKAGE_NAME = "apple-health-mcp-unofficial";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export const SUPPORTED_RECORD_TYPES = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierRespiratoryRate",
  "HKQuantityTypeIdentifierOxygenSaturation",
  "HKQuantityTypeIdentifierBodyMass",
  "HKQuantityTypeIdentifierBodyMassIndex",
  "HKQuantityTypeIdentifierBodyFatPercentage",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKCategoryTypeIdentifierMindfulSession"
];

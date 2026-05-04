import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT, SUPPORTED_RECORD_TYPES } from "../constants.js";
import { AGENT_CLIENTS } from "../services/agent-manifest.js";

export const ResponseFormatSchema = z.enum(["markdown", "json"]).default("markdown");
export const AgentClientSchema = z.enum(AGENT_CLIENTS).default("generic");
export const PrivacyModeSchema = z.enum(["summary", "structured", "raw"]).optional();

export const ResponseOnlyInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const AgentManifestInputSchema = z.object({
  client: AgentClientSchema,
  response_format: ResponseFormatSchema
}).strict();

export const ConnectionStatusInputSchema = z.object({
  client: AgentClientSchema.optional(),
  response_format: ResponseFormatSchema
}).strict();

export const RecordListInputSchema = z.object({
  type: z.string().optional().describe(`Apple Health record type, e.g. ${SUPPORTED_RECORD_TYPES[0]}.`),
  start: z.string().optional().describe("Optional ISO date/time lower bound."),
  end: z.string().optional().describe("Optional ISO date/time upper bound."),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  privacy_mode: PrivacyModeSchema,
  response_format: ResponseFormatSchema
}).strict();

export const WorkoutListInputSchema = z.object({
  start: z.string().optional().describe("Optional ISO date/time lower bound."),
  end: z.string().optional().describe("Optional ISO date/time upper bound."),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  privacy_mode: PrivacyModeSchema,
  response_format: ResponseFormatSchema
}).strict();

export const DailySummaryInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD date. Defaults to today in UTC."),
  response_format: ResponseFormatSchema
}).strict();

export const WeeklySummaryInputSchema = z.object({
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD end date. Defaults to today in UTC."),
  days: z.number().int().min(1).max(30).default(7),
  response_format: ResponseFormatSchema
}).strict();

export const PassthroughOutputSchema = z.object({}).passthrough();

export type AgentManifestInput = z.infer<typeof AgentManifestInputSchema>;
export type RecordListInput = z.infer<typeof RecordListInputSchema>;
export type WorkoutListInput = z.infer<typeof WorkoutListInputSchema>;
export type DailySummaryInput = z.infer<typeof DailySummaryInputSchema>;
export type WeeklySummaryInput = z.infer<typeof WeeklySummaryInputSchema>;

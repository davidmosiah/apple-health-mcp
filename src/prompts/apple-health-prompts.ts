import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerAppleHealthPrompts(server: McpServer): void {
  server.registerPrompt("apple_health_daily_review", {
    title: "Apple Health Daily Review",
    description: "Review a day of Apple Health export data with non-medical wellness framing.",
    argsSchema: {
      date: z.string().optional().describe("YYYY-MM-DD date to review.")
    }
  }, ({ date }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Call apple_health_connection_status first. Then call apple_health_daily_summary${date ? ` for ${date}` : ""}. Summarize activity, heart, sleep and workouts as wellness context. Do not provide medical diagnosis.`
      }
    }]
  }));

  server.registerPrompt("apple_health_weekly_review", {
    title: "Apple Health Weekly Review",
    description: "Review a week of Apple Health export data with practical habit signals.",
    argsSchema: {
      end_date: z.string().optional().describe("YYYY-MM-DD end date."),
      days: z.string().optional().describe("Number of days to review.")
    }
  }, ({ end_date, days }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Call apple_health_connection_status first. Then call apple_health_weekly_summary${end_date ? ` ending ${end_date}` : ""}${days ? ` for ${days} days` : ""}. Compare steps, sleep, workouts and heart signals. Keep guidance non-medical and privacy-conscious.`
      }
    }]
  }));
}

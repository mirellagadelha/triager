import * as z from "zod";

import { defineTool } from "./types.js";

export const classifyTicket = defineTool({
  name: "classify_ticket",

  description:
    "Classifies a ticket based solely on its content. " +
    "Use this tool exactly once as the first step, before any other action.",

  schema: z.object({
    category: z
      .enum(["billing", "technical", "account", "feedback", "other"])
      .describe("Main issue category. Use 'other' when none of the options apply."),

    urgency: z
      .enum(["low", "medium", "high"])
      .describe(
        "Use 'high' only for revenue loss or service outages; " +
          "'medium' for degraded functionality; 'low' for questions.",
      ),

    summary: z.string().max(200).describe("Summarize the issue in one sentence, in English."),
  }),

  async execute(args) {
    return { ...args, classified_at: new Date().toISOString() };
  },
});

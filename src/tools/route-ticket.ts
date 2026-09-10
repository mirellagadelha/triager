import * as z from "zod";

import { defineTool } from "./types.js";

export const routeTicket = defineTool({
  name: "route_ticket",

  description:
    "Forwards the ticket to the appropriate team based on the classification and customer information. " +
    "Use after classification and customer lookup. If the ticket does not provide enough information, " +
    "do not make assumptions; proceed without routing the ticket.",

  // This tool adds a ticket to a queue. It is not destructive or idempotent.
  semantics: { readOnly: false, destructive: false, idempotent: false, openWorld: false },

  schema: z.object({
    queue: z
      .enum(["billing", "tier1", "tier2", "success"])
      .describe("'tier2' requires a high-urgency technical issue."),

    priority: z.enum(["P1", "P2", "P3"]),

    reason: z.string().max(300).describe("Justification for the queue selection."),
  }),

  async execute(args) {
    return { routed: true, ...args };
  },
});

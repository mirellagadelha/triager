import * as z from "zod";

import { defineTool } from "./types.js";

const CUSTOMERS: Record<string, { name: string; plan: string; since: string }> = {
  "CUST-1001": { name: "Acme Ltda", plan: "enterprise", since: "2021-03-14" },
  "CUST-1002": { name: "Bruno Vieira", plan: "free", since: "2025-11-02" },
};

export const lookupCustomer = defineTool({
  name: "lookup_customer",

  description:
    "Looks up a customer record by the identifier mentioned in the ticket. " +
    "Use after classification. If the ticket does not provide an identifier, " +
    "do not make one up; proceed without enriching the ticket.",

  schema: z.object({
    customer_id: z
      .string()
      .regex(/^CUST-\d{4}$/)
      .describe("Identifier in the CUST-0000 format, extracted from the ticket."),
  }),

  async execute({ customer_id }) {
    const found = CUSTOMERS[customer_id];

    return found ? { found: true, customer_id, ...found } : { found: false, customer_id };
  },
});

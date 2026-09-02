import * as z from "zod";

import { classifyTicket } from "./classify-ticket.js";
import { lookupCustomer } from "./lookup-customer.js";
import { routeTicket } from "./route-ticket.js";

import type { ToolDefinition } from "./types.js";

const ALL: ToolDefinition[] = [classifyTicket, lookupCustomer, routeTicket];

const registry = new Map(ALL.map((tool) => [tool.name, tool]));

import type Anthropic from "@anthropic-ai/sdk";

function toInputSchema(schema: ToolDefinition["schema"]): Anthropic.Tool.InputSchema {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return { ...rest, type: "object" } as Anthropic.Tool.InputSchema;
}

export const toolSpecs: Anthropic.Tool[] = ALL.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: toInputSchema(tool.schema),
}));

export type ToolOutcome = { isError: boolean; content: string };

export async function executeTool(name: string, args: unknown): Promise<ToolOutcome> {
  const tool = registry.get(name);

  if (!tool) {
    const available = [...registry.keys()].join(", ");

    return {
      isError: true,
      content: `Tool "${name}" does not exist. Available tools: ${available}.`,
    };
  }

  const parsed = tool.schema.safeParse(args);

  if (!parsed.success) {
    return {
      isError: true,
      content: `Invalid arguments for "${name}":\n${z.prettifyError(parsed.error)}`,
    };
  }

  try {
    const result = await tool.execute(parsed.data);

    return { isError: false, content: JSON.stringify(result) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";

    return {
      isError: true,
      content: `Failed to execute "${name}": ${detail}`,
    };
  }
}

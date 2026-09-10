import type { ZodObject, infer as Infer } from "zod";

/**
 * Describes how a tool behaves.
 *
 * MCP hosts use this to decide how to handle tool calls, such as whether
 * to ask the user for confirmation. The Messages API has no equivalent.
 */
export interface ToolSemantics {
  readOnly: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld: boolean;
}

export interface ToolDefinition<T extends ZodObject = ZodObject> {
  name: string;
  description: string;
  schema: T;
  semantics: ToolSemantics;
  execute: (args: Infer<T>) => Promise<unknown> | unknown;
}

export function defineTool<T extends ZodObject>(definition: ToolDefinition<T>): ToolDefinition<T> {
  return definition;
}

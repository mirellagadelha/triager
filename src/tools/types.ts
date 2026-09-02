import type { ZodType, infer as Infer } from "zod";

export interface ToolDefinition<T extends ZodType = ZodType> {
  name: string;
  description: string;
  schema: T;
  execute: (args: Infer<T>) => Promise<unknown> | unknown;
}

export function defineTool<T extends ZodType>(definition: ToolDefinition<T>): ToolDefinition<T> {
  return definition;
}

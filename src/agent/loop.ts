import type Anthropic from "@anthropic-ai/sdk";

import type { LlmClient } from "../llm/client.js";
import { executeTool, toolSpecs } from "../tools/registry.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts.js";

export interface TriageResult {
  text: string;
  iterations: number;
  toolCalls: { name: string; isError: boolean }[];
  usage: { input: number; output: number };
  stoppedAtLimit: boolean;
}

export interface RunOptions {
  model: string;
  maxIterations: number;
}

export async function runTriage(
  client: LlmClient,
  ticket: string,
  options: RunOptions,
): Promise<TriageResult> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(ticket) }];

  const toolCalls: TriageResult["toolCalls"] = [];
  const usage = { input: 0, output: 0 };
  let iterations = 0;

  while (iterations < options.maxIterations) {
    iterations++;

    const response = await client.createMessage({
      model: options.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolSpecs,
      messages,
    });

    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return {
        text: extractText(response.content),
        iterations,
        toolCalls,
        usage,
        stoppedAtLimit: false,
      };
    }

    const requests = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const request of requests) {
      const outcome = await executeTool(request.name, request.input);
      toolCalls.push({ name: request.name, isError: outcome.isError });

      results.push({
        type: "tool_result",
        tool_use_id: request.id,
        content: outcome.content,
        is_error: outcome.isError,
      });
    }

    messages.push({ role: "user", content: results });
  }

  return {
    text: "",
    iterations,
    toolCalls,
    usage,
    stoppedAtLimit: true,
  };
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

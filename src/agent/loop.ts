import type Anthropic from "@anthropic-ai/sdk";

import type { LlmClient } from "../llm/client.js";
import { executeTool, toolSpecs } from "../tools/registry.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts.js";

export interface TriageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CallMetrics {
  latencyMs: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TriageResult {
  text: string;
  iterations: number;
  toolCalls: { name: string; isError: boolean }[];
  usage: TriageUsage;
  calls: CallMetrics[];
  stoppedAtLimit: boolean;
}

export interface RunOptions {
  model: string;
  maxIterations: number;

  /** Defaults to the historical value, so existing callers are unaffected. */
  maxTokens?: number;

  /** Omitted means each model's own default. */
  thinking?: Anthropic.MessageCreateParamsNonStreaming["thinking"];
}

const DEFAULT_MAX_TOKENS = 1024;

export async function runTriage(
  client: LlmClient,
  ticket: string,
  options: RunOptions,
): Promise<TriageResult> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildUserMessage(ticket) }];

  const toolCalls: TriageResult["toolCalls"] = [];
  const usage: TriageUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const calls: CallMetrics[] = [];
  let iterations = 0;

  while (iterations < options.maxIterations) {
    iterations++;

    const startedAt = Date.now();

    const response = await client.createMessage({
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: toolSpecs,
      messages,
      ...(options.thinking ? { thinking: options.thinking } : {}),
    });

    const call = measure(response, Date.now() - startedAt);

    calls.push(call);
    usage.input += call.input;
    usage.output += call.output;
    usage.cacheRead += call.cacheRead;
    usage.cacheWrite += call.cacheWrite;

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return {
        text: extractText(response.content),
        iterations,
        toolCalls,
        usage,
        calls,
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
    calls,
    stoppedAtLimit: true,
  };
}

function measure(response: Anthropic.Message, latencyMs: number): CallMetrics {
  return {
    latencyMs,
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  };
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

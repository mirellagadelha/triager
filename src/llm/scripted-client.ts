import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "./client.js";

export class ScriptedClient implements LlmClient {
  public readonly calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  private queue: Anthropic.Message[];

  constructor(script: Anthropic.Message[]) {
    this.queue = [...script];
  }

  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming) {
    this.calls.push(structuredClone(params));
    const next = this.queue.shift();

    if (!next) {
      throw new Error("No more scripted messages available.");
    }

    return next;
  }
}

function envelope(content: Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"]) {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as Anthropic.Message;
}

export function fakeToolUse(name: string, input: unknown, id = "toolu_fake") {
  return envelope([{ type: "tool_use", id, name, input } as Anthropic.ContentBlock], "tool_use");
}

export function fakeText(text: string) {
  return envelope([{ type: "text", text, citations: null } as Anthropic.ContentBlock], "end_turn");
}

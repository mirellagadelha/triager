import type Anthropic from "@anthropic-ai/sdk";

export interface LlmClient {
  createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming
  ): Promise<Anthropic.Message>;
}

export class RealClient implements LlmClient {
  constructor(private sdk: Anthropic) {}

  createMessage(params: Anthropic.MessageCreateParamsNonStreaming) {
    return this.sdk.messages.create(params);
  }
}

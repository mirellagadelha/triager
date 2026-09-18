import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { buildSystem, runTriage } from "../src/agent/loop.js";
import { SYSTEM_PROMPT } from "../src/agent/prompts.js";
import { ScriptedClient, fakeText, fakeToolUse } from "../src/llm/scripted-client.js";

/**
 * These tests check the preconditions of a cache hit, not the hit itself.
 *
 * A fake client that returns `cache_read_input_tokens > 0` and a test asserting it
 * is above zero would only check a number the test invented. Whether the cache
 * actually hit is proven by the real API in `usage`, recorded in every run file.
 * What can be checked offline is what makes a hit possible: the breakpoint is in
 * the right place, and the prefix is byte-identical on every call.
 */

const OPTIONS = { model: "fake", maxIterations: 8 };

function script(): ScriptedClient {
  return new ScriptedClient([
    fakeToolUse(
      "classify_ticket",
      { category: "billing", urgency: "low", summary: "Wrong charge." },
      "toolu_01",
    ),
    fakeToolUse(
      "route_ticket",
      { queue: "billing", priority: "P3", reason: "Billing question." },
      "toolu_02",
    ),
    fakeText("<triage><queue>billing</queue><priority>P3</priority><notes>x</notes></triage>"),
  ]);
}

function withUsage(message: Anthropic.Message, usage: Partial<Anthropic.Usage>): Anthropic.Message {
  return { ...message, usage: { ...message.usage, ...usage } };
}

describe("buildSystem", () => {
  it("should mark the last system block when caching", () => {
    const system = buildSystem(true);

    expect(Array.isArray(system)).toBe(true);

    const blocks = system as Anthropic.TextBlockParam[];

    expect(blocks.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks.at(-1)?.text).toBe(SYSTEM_PROMPT);
  });

  it("should send a plain string when not caching", () => {
    expect(buildSystem(false)).toBe(SYSTEM_PROMPT);
  });
});

describe("runTriage with caching", () => {
  it("should cache by default", async () => {
    const client = script();

    await runTriage(client, "My bill is wrong.", OPTIONS);

    const blocks = client.calls[0].system as Anthropic.TextBlockParam[];

    expect(blocks.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("should send no breakpoint at all when caching is off", async () => {
    const client = script();

    await runTriage(client, "My bill is wrong.", { ...OPTIONS, cache: false });

    expect(JSON.stringify(client.calls)).not.toContain("cache_control");
  });

  it("should never mark the ticket", async () => {
    const client = script();

    await runTriage(client, "My bill is wrong.", OPTIONS);

    // The ticket changes every request. Caching it adds write cost for bytes
    // that are never reused.
    for (const call of client.calls) {
      expect(JSON.stringify(call.messages)).not.toContain("cache_control");
    }
  });

  it("should send a byte-identical prefix on every call", async () => {
    const client = script();

    await runTriage(client, "My bill is wrong.", OPTIONS);

    // The precondition for every cache hit. A timestamp in the prompt, a tool list
    // in a different order, or anything else that differs between calls causes a
    // silent cache miss.
    const prefixes = client.calls.map((call) => JSON.stringify([call.tools, call.system]));

    expect(client.calls.length).toBeGreaterThan(1);
    expect(new Set(prefixes).size).toBe(1);
  });

  it("should record cache reads and writes per call and in the total", async () => {
    const client = new ScriptedClient([
      withUsage(
        fakeToolUse(
          "classify_ticket",
          { category: "billing", urgency: "low", summary: "Wrong charge." },
          "toolu_01",
        ),
        { input_tokens: 20, output_tokens: 30, cache_creation_input_tokens: 2700 },
      ),
      withUsage(
        fakeToolUse(
          "route_ticket",
          { queue: "billing", priority: "P3", reason: "Billing question." },
          "toolu_02",
        ),
        { input_tokens: 90, output_tokens: 40, cache_read_input_tokens: 2700 },
      ),
      withUsage(fakeText("<triage><queue>billing</queue><priority>P3</priority></triage>"), {
        input_tokens: 150,
        output_tokens: 50,
        cache_read_input_tokens: 2700,
      }),
    ]);

    const result = await runTriage(client, "My bill is wrong.", OPTIONS);

    // A healthy cache pattern with one write followed by reads.
    expect(result.calls.map((call) => [call.cacheWrite, call.cacheRead])).toEqual([
      [2700, 0],
      [0, 2700],
      [0, 2700],
    ]);

    expect(result.usage).toEqual({ input: 260, output: 120, cacheRead: 5400, cacheWrite: 2700 });
  });
});

import { describe, expect, it } from "vitest";
import { ScriptedClient, fakeText, fakeToolUse } from "../src/llm/scripted-client.js";
import { runTriage } from "../src/agent/loop.js";

const options = { model: "fake", maxIterations: 8 };

describe("runTriage", () => {
  it("should run the triage loop successfully", async () => {
    const client = new ScriptedClient([
      fakeToolUse("classify_ticket", {
        category: "billing",
        urgency: "medium",
        summary: "Duplicate charge on the card for customer CUST-1001.",
      }),
      fakeToolUse("lookup_customer", { customer_id: "CUST-1001" }),
      fakeToolUse("route_ticket", {
        queue: "billing",
        priority: "P2",
        reason: "Enterprise customer with billing issue.",
      }),
      fakeText("<triage><queue>billing</queue></triage>"),
    ]);

    const result = await runTriage(
      client,
      "I have been charged twice for the same service. My customer ID is CUST-1001.",
      options,
    );

    expect(result.iterations).toBe(4);
    expect(result.stoppedAtLimit).toBe(false);
    expect(result.toolCalls.map((c) => c.name)).toEqual([
      "classify_ticket",
      "lookup_customer",
      "route_ticket",
    ]);
    expect(result.text).toContain("<triage>");
  });

  it("should return the tool error to the model and continue the loop", async () => {
    const client = new ScriptedClient([
      fakeToolUse("classify_ticket", {}),
      // Simulate the model responding after receiving the tool error.
      // The content of this response is not important for the test.
      // This ensures that the loop can continue after a tool error.
      fakeText("ready"),
    ]);

    await runTriage(
      client,
      "I have been charged twice for the same service. My customer ID is CUST-1001.",
      options,
    );

    const second = client.calls[1]!;
    const lastMessage = second.messages.at(-1)!;
    const block = (lastMessage.content as any[])[0];

    expect(lastMessage.role).toBe("user");
    expect(block.type).toBe("tool_result");
    expect(block.is_error).toBe(true);
    expect(block.content).toContain("classify_ticket");
  });

  it("should stop the triage loop at the iteration limit", async () => {
    const script = Array.from({ length: 5 }, () =>
      fakeToolUse("classify_ticket", {
        category: "other",
        urgency: "low",
        summary: "loop",
      }),
    );

    const result = await runTriage(
      client_(script),
      "I have been charged twice for the same service. My customer ID is CUST-1001.",
      {
        model: "fake",
        maxIterations: 3,
      },
    );

    expect(result.stoppedAtLimit).toBe(true);
    expect(result.iterations).toBe(3);
  });
});

const client_ = (script: any[]) => new ScriptedClient(script);

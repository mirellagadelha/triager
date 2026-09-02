import type Anthropic from "@anthropic-ai/sdk";
import { ScriptedClient, fakeText, fakeToolUse } from "../src/llm/scripted-client.js";
import { runTriage } from "../src/agent/loop.js";

const client = new ScriptedClient([
  fakeToolUse(
    "classify_ticket",
    {
      category: "billing",
      urgency: "medium",
      summary: "Duplicate charge on the card for customer CUST-1001.",
    },
    "toolu_01",
  ),
  fakeToolUse("lookup_customer", { customer_id: "CUST-1001" }, "toolu_02"),
  fakeToolUse(
    "route_ticket",
    {
      queue: "billing",
      priority: "P2",
      reason: "Enterprise customer with billing issue.",
    },
    "toolu_03",
  ),
  fakeText("<triage><queue>billing</queue></triage>"),
]);

await runTriage(
  client,
  "I have been charged twice for the same service. My customer ID is CUST-1001.",
  {
    model: "fake",
    maxIterations: 8,
  },
);

function describe(block: Anthropic.ContentBlockParam): string {
  switch (block.type) {
    case "text":
      return `text("${block.text.slice(0, 45)}")`;
    case "tool_use":
      return `tool_use(${block.name}, id=${block.id})`;
    case "tool_result":
      return `tool_result(id=${block.tool_use_id}, error=${block.is_error})`;
    default:
      return block.type;
  }
}

client.calls.forEach((call, index) => {
  console.log(`\nCall ${index + 1}: ${call.messages.length} message(s)`);

  for (const message of call.messages) {
    const blocks =
      typeof message.content === "string"
        ? [`text("${message.content.slice(0, 45)}")`]
        : message.content.map(describe);

    console.log(`  ${message.role.padEnd(10)} ${blocks.join(" | ")}`);
  }
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/mcp/server.js";

let client: Client;

beforeEach(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "triager-tests", version: "0.0.0" });

  // Both ends must be connecting for the handshake to complete, so neither
  // await can come first.
  await Promise.all([createMcpServer().connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
});

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

function firstText(result: CallToolResult): string {
  const blocks = result.content as { type: string; text: string }[];

  expect(blocks).toHaveLength(1);
  expect(blocks[0].type).toBe("text");

  return blocks[0].text;
}

describe("mcp capabilities", () => {
  it("should advertise the tools capability", () => {
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });

  it("should advertise the resources capability", () => {
    expect(client.getServerCapabilities()?.resources).toBeDefined();
  });

  it("should advertise the prompts capability", () => {
    expect(client.getServerCapabilities()?.prompts).toBeDefined();
  });

  it("should advertise resource listing without resource subscription", () => {
    // Resource listing and subscriptions are separate capabilities.
    expect(client.getServerCapabilities()?.resources).toMatchObject({ listChanged: true });
    expect(client.getServerCapabilities()?.resources?.subscribe).toBeUndefined();
  });

  it("should expose the expected tools", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "classify_ticket",
      "lookup_customer",
      "route_ticket",
    ]);
  });

  it("should project tool semantics onto protocol annotations", async () => {
    const { tools } = await client.listTools();
    const annotations = new Map(tools.map((tool) => [tool.name, tool.annotations]));

    // Destructive and idempotent hints only apply to write tools.
    expect(annotations.get("classify_ticket")).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
    });

    expect(annotations.get("lookup_customer")).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
    });

    // Write tools must declare their behavior explicitly.
    expect(annotations.get("route_ticket")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});

describe("tools/call", () => {
  it("should execute classify_ticket successfully", async () => {
    const result = await client.callTool({
      name: "classify_ticket",
      arguments: {
        category: "technical",
        urgency: "high",
        summary: "Dashboard has been down since 9 AM.",
      },
    });

    expect(result.isError).toBeFalsy();

    expect(JSON.parse(firstText(result))).toMatchObject({
      category: "technical",
      urgency: "high",
    });
  });

  it("should execute route_ticket successfully", async () => {
    const result = await client.callTool({
      name: "route_ticket",
      arguments: {
        queue: "tier2",
        priority: "P1",
        reason: "High-urgency technical outage.",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(firstText(result))).toMatchObject({ routed: true, queue: "tier2" });
  });

  it("should report a missing customer as a successful call", async () => {
    const result = await client.callTool({
      name: "lookup_customer",
      arguments: { customer_id: "CUST-9999" },
    });

    // A missing customer is a valid result, not an error.
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(firstText(result))).toMatchObject({ found: false });
  });
});

describe("tools/call error handling", () => {
  // A failed call returns isError; an unknown method rejects.

  it("should resolve with isError for invalid arguments", async () => {
    await expect(
      client.callTool({
        name: "lookup_customer",
        arguments: { customer_id: "nope" },
      }),
    ).resolves.toMatchObject({ isError: true });
  });

  it("should resolve with isError for an unknown tool", async () => {
    await expect(
      client.callTool({ name: "classify_tickets", arguments: {} }),
    ).resolves.toMatchObject({ isError: true });
  });

  it("should reject for a method the server does not implement", async () => {
    // Unsupported methods fail at the protocol level rather than in-band.
    await expect(client.subscribeResource({ uri: "triager://customers" })).rejects.toThrow();
  });
});

describe("resources", () => {
  it("should list the customers resource", async () => {
    const { resources } = await client.listResources();

    expect(resources.map((resource) => resource.uri)).toEqual(["triager://customers"]);
    expect(resources[0].mimeType).toBe("application/json");
  });

  it("should read the customers resource", async () => {
    const { contents } = await client.readResource({ uri: "triager://customers" });

    expect(contents).toHaveLength(1);

    const [content] = contents;

    expect(content.uri).toBe("triager://customers");

    if (!("text" in content)) {
      throw new Error("expected a text resource, got a blob");
    }

    expect(JSON.parse(content.text)).toMatchObject({
      "CUST-1001": { plan: "enterprise" },
    });
  });

  it("should reject reading an unknown uri", async () => {
    await expect(client.readResource({ uri: "triager://nope" })).rejects.toThrow();
  });
});

describe("prompts", () => {
  it("should list triage_ticket with its argument metadata", async () => {
    const { prompts } = await client.listPrompts();

    expect(prompts.map((prompt) => prompt.name)).toEqual(["triage_ticket"]);

    // Optional so the prompt can still run without the argument.
    expect(prompts[0].arguments).toMatchObject([{ name: "ticket", required: false }]);
  });

  it("should interpolate the ticket into a single user message", async () => {
    const ticket = "Charged twice since March. Customer CUST-1001.";
    const { messages } = await client.getPrompt({ name: "triage_ticket", arguments: { ticket } });

    expect(messages).toHaveLength(1);

    // PromptMessage has no system role, so the instructions are sent as user content.
    expect(messages[0].role).toBe("user");

    const { content } = messages[0];

    if (content.type !== "text") {
      throw new Error(`expected a text block, got ${content.type}`);
    }

    expect(content.text).toContain(`<ticket>\n${ticket}\n</ticket>`);
    expect(content.text).toContain("<procedure>");
  });

  it("should reject an unknown prompt", async () => {
    await expect(client.getPrompt({ name: "nope", arguments: {} })).rejects.toThrow();
  });

  it("should still deliver the procedure with no ticket argument", async () => {
    const { messages } = await client.getPrompt({ name: "triage_ticket", arguments: {} });

    const { content } = messages[0];

    if (content.type !== "text") {
      throw new Error(`expected a text block, got ${content.type}`);
    }

    expect(content.text).toContain("<procedure>");
    expect(content.text).toContain("described in this conversation");
    expect(content.text).not.toContain("<ticket>\n");
  });

  it("should mark the conversation as authoritative over a mangled argument", async () => {
    // Hosts may truncate the argument, so the user's message takes precedence.
    const { messages } = await client.getPrompt({
      name: "triage_ticket",
      arguments: { ticket: "duplicate" },
    });

    const { content } = messages[0];

    if (content.type !== "text") {
      throw new Error(`expected a text block, got ${content.type}`);
    }

    expect(content.text).toContain("<ticket>\nduplicate\n</ticket>");
    expect(content.text).toContain("fuller ticket text");
  });
});

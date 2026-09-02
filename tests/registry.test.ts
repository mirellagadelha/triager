import { describe, expect, it } from "vitest";
import { executeTool, toolSpecs } from "../src/tools/registry.js";

describe("tool registry", () => {
  it("should expose the expected tools", () => {
    expect(toolSpecs.map((t) => t.name).sort()).toEqual([
      "classify_ticket",
      "lookup_customer",
      "route_ticket",
    ]);
  });

  it("should return an error for an unknown tool", async () => {
    const result = await executeTool("classify_tickets", {});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("classify_tickets");
  });

  it("should return an error for invalid arguments", async () => {
    const result = await executeTool("classify_ticket", {
      category: "billing",
      urgency: "very_urgent",
      summary: "Duplicate charge on the card.",
    });

    expect(result.isError).toBe(true);
  });
});

describe("executeTool", () => {
  it("should execute classify_ticket successfully", async () => {
    const result = await executeTool("classify_ticket", {
      category: "technical",
      urgency: "high",
      summary: "Dashboard has been down since 9 AM.",
    });

    expect(result.isError).toBe(false);

    expect(JSON.parse(result.content)).toMatchObject({
      category: "technical",
    });
  });

  it("should execute lookup_customer successfully", async () => {
    const result = await executeTool("lookup_customer", {
      customer_id: "CUST-1001",
    });

    expect(result.isError).toBe(false);

    expect(JSON.parse(result.content)).toMatchObject({
      found: true,
      plan: "enterprise",
    });
  });
});

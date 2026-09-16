import { describe, expect, it } from "vitest";

import { CASES, casesOfKind } from "../evals/cases.js";
import { baselines, gradeRoute, parseTriage } from "../evals/graders.js";
import { VARIANTS, fingerprint, runSuite } from "../evals/runner.js";
import { ScriptedClient, fakeText, fakeToolUse } from "../src/llm/scripted-client.js";

const ROUTE_CASES = casesOfKind("route");

function triageBlock(queue: string, priority: string, notes = "Notes."): string {
  return `<triage>\n  <queue>${queue}</queue>\n  <priority>${priority}</priority>\n  <notes>${notes}</notes>\n</triage>`;
}

describe("dataset", () => {
  it("should have 15 route cases with unique ids", () => {
    expect(ROUTE_CASES).toHaveLength(15);
    expect(new Set(CASES.map((item) => item.id)).size).toBe(CASES.length);
  });

  it("should match the declared queue distribution", () => {
    const counts = new Map<string, number>();

    for (const item of ROUTE_CASES) {
      counts.set(item.expect.queue, (counts.get(item.expect.queue) ?? 0) + 1);
    }

    expect(Object.fromEntries(counts)).toEqual({ billing: 4, tier1: 5, tier2: 3, success: 3 });
  });

  it("should expect a lookup exactly when the ticket carries an identifier", () => {
    for (const item of ROUTE_CASES) {
      const inTicket = /CUST-\d{4}/.exec(item.ticket);

      // A label that conflicts with the ticket is a grading bug,
      // which can silently invalidate the results.
      expect(inTicket !== null, `${item.id}: identifier in text vs expect.lookup`).toBe(
        item.expect.lookup !== null,
      );

      if (item.expect.lookup) {
        expect(item.ticket).toContain(item.expect.lookup);
      }
    }
  });

  it("should cover both sides of the lookup decision", () => {
    const withCustomer = ROUTE_CASES.filter((item) => item.expect.lookup !== null);

    expect(withCustomer).toHaveLength(8);
    expect(ROUTE_CASES.length - withCustomer.length).toBe(7);
  });

  it("should explain where every label came from", () => {
    for (const item of CASES) {
      expect(item.rationale.length, `${item.id} missing rationale`).toBeGreaterThan(20);
    }
  });
});

describe("parseTriage", () => {
  it("should read queue, priority and notes", () => {
    expect(parseTriage(triageBlock("billing", "P2", "Duplicate charge."))).toEqual({
      queue: "billing",
      priority: "P2",
      notes: "Duplicate charge.",
    });
  });

  it("should ignore text around the block", () => {
    const text = `Sure, here is the result:\n\n${triageBlock("tier1", "P3")}\n\nAnything else?`;

    expect(parseTriage(text)?.queue).toBe("tier1");
  });

  it("should return null when there is no triage block", () => {
    expect(parseTriage("I routed the ticket to billing as P2.")).toBeNull();
  });

  it("should return null when the block is missing a required field", () => {
    expect(parseTriage("<triage><queue>billing</queue></triage>")).toBeNull();
  });
});

describe("gradeRoute", () => {
  const testCase = ROUTE_CASES[0]; // route-01: billing, P2, customer lookup

  function resultWith(text: string, tools: string[]) {
    return {
      text,
      iterations: tools.length + 1,
      toolCalls: tools.map((name) => ({ name, isError: false })),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      calls: [],
      stoppedAtLimit: false,
    };
  }

  const honestPath = ["classify_ticket", "lookup_customer", "route_ticket"];

  it("should pass the expected answer", () => {
    const grade = gradeRoute(testCase, resultWith(triageBlock("billing", "P2"), honestPath));

    expect(grade.correct).toBe(true);
    expect(grade.lookupOk).toBe(true);
    expect(grade.trajectoryOk).toBe(true);
  });

  it("should fail a well-formed answer with the wrong queue", () => {
    const grade = gradeRoute(testCase, resultWith(triageBlock("tier1", "P2"), honestPath));

    expect(grade.correct).toBe(false);
    expect(grade.formatOk).toBe(true);
    expect(grade.queueOk).toBe(false);
    expect(grade.priorityOk).toBe(true);
  });

  it("should separate a priority miss from a queue miss", () => {
    const grade = gradeRoute(testCase, resultWith(triageBlock("billing", "P3"), honestPath));

    expect(grade.correct).toBe(false);
    expect(grade.queueOk).toBe(true);
    expect(grade.priorityOk).toBe(false);
  });

  it("should fail when the customer lookup was skipped", () => {
    const grade = gradeRoute(
      testCase,
      resultWith(triageBlock("billing", "P2"), ["classify_ticket", "route_ticket"]),
    );

    expect(grade.correct).toBe(true);
    expect(grade.lookupOk).toBe(false);
    expect(grade.trajectoryOk).toBe(false);
  });

  it("should fail when the customer was invented", () => {
    const noCustomer = ROUTE_CASES.find((item) => item.expect.lookup === null)!;

    const grade = gradeRoute(
      noCustomer,
      resultWith(triageBlock(noCustomer.expect.queue, noCustomer.expect.priority), [
        "classify_ticket",
        "lookup_customer",
        "route_ticket",
      ]),
    );

    expect(grade.correct).toBe(true);
    expect(grade.lookupOk).toBe(false);
  });
});

describe("baselines", () => {
  it("should report what a dumb constant answer would score", () => {
    const reference = baselines(ROUTE_CASES);

    expect(reference.total).toBe(15);

    // tier1 is the most common queue (5/15), and P3 is the most common priority (8/15),
    // but the most common pair appears in only 3/15 cases (20%).
    expect(reference.queue).toEqual({ value: "tier1", correct: 5 });
    expect(reference.priority).toEqual({ value: "P3", correct: 8 });
    expect(reference.headline.correct).toBe(3);

    // Three constant answers tie at 3 correct, including success/P3, tier1/P3, and tier2/P1.
    // Only the score matters; the selected tied answer does not.
    expect(reference.headline.tied).toBe(3);
  });

  it("should not depend on the order of the cases in the file", () => {
    const reversed = baselines([...ROUTE_CASES].reverse());

    expect(reversed.headline).toEqual(baselines(ROUTE_CASES).headline);
  });
});

describe("runSuite", () => {
  it("should run a case end to end without touching the API", async () => {
    const testCase = ROUTE_CASES[0];

    const client = new ScriptedClient([
      fakeToolUse(
        "classify_ticket",
        { category: "billing", urgency: "low", summary: "Seat count on the invoice is wrong." },
        "toolu_01",
      ),
      fakeToolUse("lookup_customer", { customer_id: "CUST-1001" }, "toolu_02"),
      fakeToolUse(
        "route_ticket",
        { queue: "billing", priority: "P2", reason: "Enterprise billing discrepancy." },
        "toolu_03",
      ),
      fakeText(triageBlock("billing", "P2", "Seat count mismatch. Enterprise customer.")),
    ]);

    const run = await runSuite(client, [testCase], VARIANTS["sonnet-off"]);

    expect(run.variant).toBe("sonnet-off");
    expect(run.cases).toHaveLength(1);
    expect(run.cases[0].grade.correct).toBe(true);
    expect(run.cases[0].iterations).toBe(4);
    expect(run.cases[0].apiMs).toBeGreaterThanOrEqual(0);
  });

  it("should pass the variant settings down to the API call", async () => {
    const client = new ScriptedClient([fakeText(triageBlock("tier1", "P3"))]);

    await runSuite(client, [ROUTE_CASES[10]], VARIANTS["sonnet-adaptive"]);

    expect(client.calls[0].model).toBe("claude-sonnet-5");
    expect(client.calls[0].thinking).toEqual({ type: "adaptive" });
    expect(client.calls[0].max_tokens).toBe(4096);
  });

  it("should omit thinking for the cheap tier", async () => {
    const client = new ScriptedClient([fakeText(triageBlock("tier1", "P3"))]);

    await runSuite(client, [ROUTE_CASES[10]], VARIANTS["haiku-off"]);

    expect(client.calls[0].model).toBe("claude-haiku-4-5");
    expect(client.calls[0].thinking).toBeUndefined();
  });
});

describe("fingerprint", () => {
  it("should ignore fields that never reach the model", () => {
    const relabelled = ROUTE_CASES.map((item) => ({ ...item, rationale: "reworded", tags: [] }));

    // Rewording a rationale or a tag does not change what was measured.
    expect(fingerprint(relabelled)).toBe(fingerprint(ROUTE_CASES));
  });

  it("should change when a ticket or a label changes", () => {
    const base = fingerprint(ROUTE_CASES);

    const retyped = ROUTE_CASES.map((item, index) =>
      index === 0 ? { ...item, ticket: `${item.ticket} ` } : item,
    );
    const relabelled = ROUTE_CASES.map((item, index) =>
      index === 0 ? { ...item, expect: { ...item.expect, priority: "P1" as const } } : item,
    );

    // A baseline scored against a different case set is not a baseline.
    expect(fingerprint(retyped)).not.toBe(base);
    expect(fingerprint(relabelled)).not.toBe(base);
  });
});

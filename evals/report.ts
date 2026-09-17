import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { casesOfKind } from "./cases.js";
import { baselines } from "./graders.js";
import { costOf } from "./pricing.js";
import type { SuiteRun } from "./runner.js";

interface Row {
  variant: string;
  model: string;
  cases: number;
  correct: number;
  queueOk: number;
  priorityOk: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  apiMs: number;
}

function summarize(run: SuiteRun): Row {
  const count = (pick: (grade: SuiteRun["cases"][number]["grade"]) => boolean) =>
    run.cases.filter((item) => pick(item.grade)).length;

  const totals = run.cases.reduce(
    (sum, item) => ({
      input: sum.input + item.usage.input,
      output: sum.output + item.usage.output,
      cacheRead: sum.cacheRead + item.usage.cacheRead,
      cacheWrite: sum.cacheWrite + item.usage.cacheWrite,
      apiMs: sum.apiMs + item.apiMs,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, apiMs: 0 },
  );

  return {
    variant: run.variant,
    model: run.model,
    cases: run.cases.length,
    correct: count((grade) => grade.correct),
    queueOk: count((grade) => grade.queueOk),
    priorityOk: count((grade) => grade.priorityOk),
    ...totals,
    cost: costOf(run.model, totals),
  };
}

function percent(part: number, total: number): string {
  return `${Math.round((part / total) * 100)}%`.padStart(4);
}

export function compare(runs: SuiteRun[]): void {
  const unverified = runs.filter((run) => !run.cases_fingerprint).map((run) => run.variant);

  if (unverified.length > 0) {
    console.log(`\nUnverified case set (no fingerprint): ${unverified.join(", ")}.`);
  }

  const prints = new Set(
    runs.filter((run) => run.cases_fingerprint).map((run) => run.cases_fingerprint),
  );

  if (prints.size > 1) {
    throw new Error(
      `These runs were scored against different case sets (${[...prints].join(", ")}). ` +
        "Re-run them against the same cases before comparing.",
    );
  }

  // Different agents over the same cases are valid for before/after comparisons.
  // The agent fingerprint explains what changed between runs.
  const agents = new Set(runs.map((run) => run.agent_fingerprint ?? "(unrecorded)"));

  if (agents.size > 1) {
    console.log("\nThese runs measured different agents (prompt or tools changed):");

    for (const run of runs) {
      console.log(`  ${run.variant.padEnd(17)} agent ${run.agent_fingerprint ?? "(unrecorded)"}`);
    }
  }

  const rows = runs.map(summarize);
  const header = ["variant", "model", "correct", "queue", "prio", "cost", "per case", "latency"];

  console.log(
    `\n${header[0].padEnd(17)}${header[1].padEnd(19)}${header[2].padEnd(9)}` +
      `${header[3].padEnd(7)}${header[4].padEnd(7)}${header[5].padEnd(10)}` +
      `${header[6].padEnd(11)}${header[7]}`,
  );

  for (const row of rows) {
    console.log(
      row.variant.padEnd(17) +
        row.model.padEnd(19) +
        `${percent(row.correct, row.cases)}     `.padEnd(9) +
        `${percent(row.queueOk, row.cases)}  `.padEnd(7) +
        `${percent(row.priorityOk, row.cases)}  `.padEnd(7) +
        `$${row.cost.toFixed(4)}`.padEnd(10) +
        `$${(row.cost / row.cases).toFixed(4)}`.padEnd(11) +
        `${Math.round(row.apiMs / row.cases)}ms`,
    );
  }

  const reference = baselines(casesOfKind("route"));

  console.log(
    `\n${"always the same answer".padEnd(36)}` +
      `${percent(reference.headline.correct, reference.total)}`,
  );

  // With 15 cases each one is worth about 7 points, so a one-case gap is noise.
  const worth = 100 / rows[0].cases;

  console.log(
    `\nOne case is worth ${worth.toFixed(1)} points. A gap of one case is not a result.\n`,
  );

  for (const row of rows) {
    console.log(
      `${row.variant.padEnd(17)} tokens in ${row.input}  out ${row.output}` +
        `  cache-read ${row.cacheRead}  cache-write ${row.cacheWrite}`,
    );
  }

  console.log();
}

function main(): void {
  const files = process.argv.slice(2).filter((arg) => arg.endsWith(".json"));

  if (files.length === 0) {
    throw new Error("Pass one or more result files.");
  }

  compare(files.map((file) => JSON.parse(readFileSync(file, "utf8")) as SuiteRun));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

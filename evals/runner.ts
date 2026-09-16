/**
 * Runs the suite one case at a time, grades, prints, and saves results.
 *
 * `runSuite` receives the client intentionally so tests can use
 * `ScriptedClient` without API calls or cost.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

import { runTriage } from "../src/agent/loop.js";
import type { RunOptions, TriageUsage } from "../src/agent/loop.js";
import { RealClient } from "../src/llm/client.js";
import type { LlmClient } from "../src/llm/client.js";
import { CASES, casesOfKind } from "./cases.js";
import type { EvalCase } from "./cases.js";
import { baselines, gradeRoute } from "./graders.js";
import { costOf } from "./pricing.js";
import type { RouteGrade } from "./graders.js";

export interface Variant {
  name: string;
  model: string;
  thinking?: RunOptions["thinking"];
}

export interface CaseRun {
  id: string;
  tags: string[];
  grade: RouteGrade;
  usage: TriageUsage;
  apiMs: number;
  wallMs: number;
  iterations: number;
  stoppedAtLimit: boolean;
  text: string;
}

export interface SuiteRun {
  variant: string;
  model: string;
  startedAt: string;

  /** Two runs are comparable only if this matches. */
  cases_fingerprint: string;
  cases: CaseRun[];
}

export const VARIANTS: Record<string, Variant> = {
  "sonnet-off": { name: "sonnet-off", model: "claude-sonnet-5", thinking: { type: "disabled" } },
  "sonnet-adaptive": {
    name: "sonnet-adaptive",
    model: "claude-sonnet-5",
    thinking: { type: "adaptive" },
  },
  "haiku-off": { name: "haiku-off", model: "claude-haiku-4-5" },
};

const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 8;

/**
 * Fingerprint of the exact cases a run was scored against.
 */
export function fingerprint(cases: EvalCase[]): string {
  const payload = cases.map((item) => [item.id, item.ticket, item.expect]);

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export async function runSuite(
  client: LlmClient,
  cases: EvalCase[],
  variant: Variant,
): Promise<SuiteRun> {
  const runs: CaseRun[] = [];

  // Runs each test case sequentially to avoid network contention affecting measured times.
  for (const testCase of cases) {
    const startedAt = Date.now();

    const result = await runTriage(client, testCase.ticket, {
      model: variant.model,
      maxIterations: MAX_ITERATIONS,
      maxTokens: MAX_TOKENS,
      thinking: variant.thinking,
    });

    runs.push({
      id: testCase.id,
      tags: testCase.tags,
      grade: gradeRoute(testCase, result),
      usage: result.usage,
      apiMs: result.calls.reduce((total, call) => total + call.latencyMs, 0),
      wallMs: Date.now() - startedAt,
      iterations: result.iterations,
      stoppedAtLimit: result.stoppedAtLimit,
      text: result.text,
    });
  }

  return {
    variant: variant.name,
    model: variant.model,
    startedAt: new Date().toISOString(),
    cases_fingerprint: fingerprint(cases),
    cases: runs,
  };
}

function share(count: number, total: number): string {
  return `${((count / total) * 100).toFixed(0).padStart(3)}% (${count}/${total})`;
}

function rate(runs: CaseRun[], pick: (grade: RouteGrade) => boolean): string {
  return share(runs.filter((run) => pick(run.grade)).length, runs.length);
}

export function printSummary(run: SuiteRun, cases: EvalCase[]): void {
  const reference = baselines(cases);

  console.log(`\n${run.variant}  (${run.model})\n`);

  for (const item of run.cases) {
    const mark = item.grade.correct ? "ok  " : "FAIL";
    const got = item.grade.got;
    const detail = got ? `${got.queue}/${got.priority}` : "<no triage block>";

    console.log(`  ${mark} ${item.id}  ${detail.padEnd(18)} ${item.apiMs}ms`);
  }

  console.log(
    "\n  queue + priority     ",
    rate(run.cases, (grade) => grade.correct),
  );
  console.log(
    "  queue only           ",
    rate(run.cases, (grade) => grade.queueOk),
  );
  console.log(
    "  priority only        ",
    rate(run.cases, (grade) => grade.priorityOk),
  );
  console.log(
    "  XML format           ",
    rate(run.cases, (grade) => grade.formatOk),
  );
  console.log(
    "  lookup when needed    ",
    rate(run.cases, (grade) => grade.lookupOk),
  );
  console.log(
    "  tool path             ",
    rate(run.cases, (grade) => grade.trajectoryOk),
  );

  // The naive baseline. This shows whether the model actually improves on a fixed guess.
  const tie = reference.headline.tied > 1 ? `, tied with ${reference.headline.tied - 1}` : "";

  console.log(
    `\n  naive baseline       `,
    `${share(reference.headline.correct, reference.total)}`,
    `<- always "${reference.headline.queue}" / ${reference.headline.priority}${tie}`,
  );

  const byTag = (tag: string) => run.cases.filter((item) => item.tags.includes(tag));

  for (const tag of ["unambiguous", "ambiguous"]) {
    const group = byTag(tag);

    if (group.length > 0) {
      console.log(
        `  ${tag.padEnd(20)}`,
        rate(group, (grade) => grade.correct),
      );
    }
  }

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

  console.log(
    `\n  tokens              in ${totals.input}  out ${totals.output}` +
      `  cache-read ${totals.cacheRead}  cache-write ${totals.cacheWrite}`,
  );
  console.log(
    `  API latency         ${totals.apiMs}ms total, ` +
      `${Math.round(totals.apiMs / run.cases.length)}ms per case`,
  );
  console.log(`  cost                $${costOf(run.model, totals).toFixed(4)}\n`);
}

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? fallback : process.argv[index + 1];
}

async function main(): Promise<void> {
  const variantName = flag("variant", "sonnet-off") as string;
  const variant = VARIANTS[variantName];

  if (!variant) {
    throw new Error(
      `Variant "${variantName}" does not exist. Options: ${Object.keys(VARIANTS).join(", ")}.`,
    );
  }

  const kind = flag("kind", "route") as EvalCase["kind"];
  const only = flag("case");

  const selected = only
    ? CASES.filter((item) => item.id === only)
    : casesOfKind(kind).filter((item) => item.expect !== undefined);

  if (selected.length === 0) {
    throw new Error("No cases selected.");
  }

  console.log(`Running ${selected.length} case(s) with ${variant.name}. This consumes tokens.`);

  const client = new RealClient(new Anthropic());
  const run = await runSuite(client, selected, variant);

  printSummary(run, selected);

  const stamp = run.startedAt.replace(/[:.]/g, "-");
  const out = flag("out", `evals/results/${variant.name}-${stamp}.json`) as string;

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);

  console.log(`Result saved to ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

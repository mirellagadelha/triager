/** US dollars per million tokens. */
export interface Rate {
  input: number;
  output: number;
}

export const RATES: Record<string, Rate> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

/**
 * Cache reads cost about a tenth of a normal input token; writes cost 1.25x.
 *
 * So the second request over the same prefix already breaks even: 1.25 + 0.1 is
 * cheaper than paying full price twice.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

export interface CostInput {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export function costOf(model: string, usage: CostInput): number {
  const rate = RATES[model];

  if (!rate) {
    throw new Error(`No price on file for "${model}". Add it to RATES before reporting cost.`);
  }

  const perToken = { input: rate.input / 1e6, output: rate.output / 1e6 };

  return (
    usage.input * perToken.input +
    usage.output * perToken.output +
    (usage.cacheRead ?? 0) * perToken.input * CACHE_READ_MULTIPLIER +
    (usage.cacheWrite ?? 0) * perToken.input * CACHE_WRITE_MULTIPLIER
  );
}

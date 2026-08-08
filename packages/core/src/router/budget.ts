/**
 * Session budget gate for model routing.
 *
 * Converts persisted token usage into a USD estimate using a model's advertised
 * cost tier, then decides whether routing may still pick a strong tier once a
 * per-session ceiling is hit. Pure functions — the router service feeds these
 * the session's tokens and the configured budget.
 */

import type { ModelV2 } from "../model"
import type { SessionSchema } from "../session/schema"

export const CHEAP_TIER = "S" as const

export type BudgetAction = "warn" | "cap"

export interface BudgetDecision {
  readonly status: "ok" | "warn" | "cap"
  /** Tier routing may use. cap downgrades to the cheap tier. */
  readonly tier: "S" | "M" | "L" | "XL"
  readonly reason?: string
}

export interface BudgetInput {
  readonly spentUsd: number
  readonly limitUsd: number
  readonly action: BudgetAction
  readonly tier: "S" | "M" | "L" | "XL"
}

/** Per-million-token rates from a model's first (or context-matched) cost tier. */
export function rate(model: ModelV2.Info): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const cost = model.cost[0]
  if (!cost) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  return {
    input: cost.input ?? 0,
    output: cost.output ?? 0,
    cacheRead: cost.cache?.read ?? 0,
    cacheWrite: cost.cache?.write ?? 0,
  }
}

/** USD cost of a persisted token usage sample against a model's rate. */
export function spendUsd(tokens: SessionSchema.Info["tokens"], model: ModelV2.Info): number {
  const rates = rate(model)
  if (rates.input === 0 && rates.output === 0) return 0
  return (
    (tokens.input * rates.input + tokens.output * rates.output + tokens.cache.read * rates.cacheRead +
      tokens.cache.write * rates.cacheWrite) /
    1_000_000
  )
}

export function evaluateBudget(input: BudgetInput): BudgetDecision {
  if (input.spentUsd <= input.limitUsd) return { status: "ok", tier: input.tier }
  if (input.action === "cap") {
    return {
      status: "cap",
      tier: CHEAP_TIER,
      reason: `spend ${input.spentUsd.toFixed(2)} USD exceeded limit ${input.limitUsd}; capped to cheap tier`,
    }
  }
  return {
    status: "warn",
    tier: input.tier,
    reason: `spend ${input.spentUsd.toFixed(2)} USD exceeded limit ${input.limitUsd}; continuing (warn)`,
  }
}

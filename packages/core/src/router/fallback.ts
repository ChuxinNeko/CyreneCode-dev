/**
 * Cross-model error fallback for model routing.
 *
 * The LLM executor already retries the *same* request for retryable errors
 * (RateLimit / ProviderInternal / Transport) with backoff. If those retries
 * still fail while routing was applied, the turn loop may re-attempt the turn
 * once on the baseline (single-model) path. This module only answers *whether*
 * such a fallback is warranted — the turn loop owns the actual re-attempt.
 */

import { LLMError } from "@opencode-ai/llm"

/**
 * True when a surfaced provider failure is worth one re-attempt on a different
 * model. Uses the same canonical `retryable` signal the executor keys on, so
 * context-overflow (which routes to compaction, not model fallback) and
 * non-retryable errors are excluded by construction.
 */
export function isRetryableError(error: unknown): boolean {
  return error instanceof LLMError && error.retryable === true
}

export interface FallbackTarget {
  readonly reason: "routing_fallback"
  readonly message: string
}

/** Describes the fallback when routing was applied and the routed model failed. */
export function fallbackForRouted(routedApplied: boolean): FallbackTarget | undefined {
  if (!routedApplied) return undefined
  return {
    reason: "routing_fallback",
    message: "routed model failed; retrying on the baseline model",
  }
}

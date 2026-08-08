import { describe, expect, it } from "bun:test"
import * as Budget from "@opencode-ai/core/router/budget"

const tokens = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  reasoning: 0,
  cache: { read: cacheRead, write: cacheWrite },
})

const model = (input: number, output: number) =>
  ({
    cost: [{ input, output, cache: { read: input / 2, write: output / 2 } }],
  }) as never

describe("budget.spendUsd", () => {
  it("computes USD from token usage and model cost", () => {
    // 1M input tokens at $10/M + 500k output at $20/M + cache
    const modelInfo = {
      cost: [{ input: 10, output: 20, cache: { read: 5, write: 4 } }],
    } as never
    const spent = Budget.spendUsd(
      tokens(1_000_000, 500_000, 200_000, 100_000),
      modelInfo,
    )
    expect(spent).toBeCloseTo(10 + 10 + 1 + 0.4, 5)
  })

  it("returns 0 when the model has no cost data", () => {
    const modelInfo = { cost: [] } as never
    expect(Budget.spendUsd(tokens(100, 100), modelInfo)).toBe(0)
  })
})

describe("budget.evaluateBudget", () => {
  it("keeps the tier when under the ceiling", () => {
    const d = Budget.evaluateBudget({ spentUsd: 1, limitUsd: 5, action: "warn", tier: "L" })
    expect(d.status).toBe("ok")
    expect(d.tier).toBe("L")
  })

  it("warns but keeps the tier over the ceiling", () => {
    const d = Budget.evaluateBudget({ spentUsd: 6, limitUsd: 5, action: "warn", tier: "XL" })
    expect(d.status).toBe("warn")
    expect(d.tier).toBe("XL")
  })

  it("caps to the cheap tier over the ceiling", () => {
    const d = Budget.evaluateBudget({ spentUsd: 6, limitUsd: 5, action: "cap", tier: "XL" })
    expect(d.status).toBe("cap")
    expect(d.tier).toBe("S")
    expect(d.reason).toContain("capped")
  })
})

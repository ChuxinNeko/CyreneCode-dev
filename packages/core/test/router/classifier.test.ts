import { describe, expect, it } from "bun:test"
import { classify, isTrivial, tierIndex } from "@opencode-ai/core/router/classifier"

const classifyText = (text: string, turnIndex = 0, depthFloor = 8) =>
  classify({ text, turnIndex, depthFloor })

describe("classifier.isTrivial", () => {
  it("recognizes en/zh ack phrases", () => {
    for (const ack of ["thanks", "ok", "thank you", "收到", "好的", "谢谢", "是的", "知道了"]) {
      expect(isTrivial(ack)).toBe(true)
    }
  })
  it("does not treat real requests as trivial", () => {
    for (const msg of ["can you review this diff", "帮我重构这个模块", "what does this error mean?"]) {
      expect(isTrivial(msg)).toBe(false)
    }
  })
})

describe("classifier.classify", () => {
  it("routes trivial acks to S", () => {
    const result = classifyText("ok thanks")
    expect(result.tier).toBe("S")
    expect(result.reasons).toContain("trivial_ack")
  })

  it("keeps ordinary requests on M", () => {
    const result = classifyText("Please summarize the recent commits in this repo")
    expect(result.tier).toBe("M")
    expect(result.reasons).not.toContain("flag_upgrade")
  })

  it("upgrades to L on debug flags", () => {
    const result = classifyText("There is an exception traceback during startup, let me find the root cause")
    expect(result.tier).toBe("L")
    expect(result.reasons).toContain("flag_upgrade")
  })

  it("upgrades to L on high_risk", () => {
    const result = classifyText("部署到生产环境前需要回滚保护")
    expect(result.tier).toBe("L")
  })

  it("upgrades to XL when high risk is combined with debug", () => {
    const result = classifyText(
      "The production deploy is failing with a migration error during rollback, need to fix root cause before customer-facing release",
    )
    expect(result.tier).toBe("XL")
    expect(tierIndex(result.tier)).toBe(3)
  })

  it("upgrades to L on long context", () => {
    const long = "a".repeat(7000)
    const result = classifyText(`review this long document: ${long}`)
    expect(result.tier).toBe("L")
    expect(result.flags.longContext).toBe(true)
  })

  it("does not route a load-bearing code message to the cheap tier", () => {
    // Even though it looks short, a message carrying a code block + file ref
    // must not ride the S tier.
    const result = classifyText("apply this diff + ```ts\nconst x = 1\n```\nsee src/main.ts:42")
    expect(result.tier).toBe("M")
    expect(result.trivial).toBe(false)
    expect(result.difficulty).toBeGreaterThan(0.4)
  })

  it("lifts S to M at the conversation-depth floor", () => {
    const result = classifyText("ok", 12, 8)
    expect(result.tier).toBe("M")
    expect(result.reasons).toContain("depth_floor")
  })

  it("respects strict-format flags", () => {
    const result = classifyText('Return only JSON, no explanation, per schema: {"ok": true}')
    expect(result.flags.strictFormat).toBe(true)
  })

  it("keeps deep-but-plain turns on M", () => {
    const result = classifyText("continue with the summary", 12, 8)
    expect(result.tier).toBe("M")
  })
})

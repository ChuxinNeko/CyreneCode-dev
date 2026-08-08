import { describe, expect, it } from "bun:test"
import { Schema } from "effect"
import { Config } from "@opencode-ai/core/config"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const

describe("router config section", () => {
  it("decodes a V2 router block through Config.Info", () => {
    const decoded = Schema.decodeUnknownSync(Config.Info)({
      router: {
        enabled: true,
        mode: "full",
        tiers: { S: "openai/gpt-5-nano", M: "openai/gpt-5", XL: "anthropic/claude-opus-4-8" },
        budget: { limitUsd: 5, action: "cap" },
        depthFloor: 8,
      },
    })
    expect(decoded.router?.enabled).toBe(true)
    expect(decoded.router?.mode).toBe("full")
    expect(decoded.router?.tiers?.S).toBe("openai/gpt-5-nano")
    expect(decoded.router?.budget?.limitUsd).toBe(5)
  })

  it("treats disabled/missing router as a no-op (single-model path unchanged)", () => {
    const decoded = Schema.decodeUnknownSync(Config.Info)({})
    expect(decoded.router).toBeUndefined()
  })

  it("preserves router through the V1 -> V2 migration", () => {
    const v1 = Schema.decodeUnknownSync(ConfigV1.Info)({
      model: "openai/gpt-5",
      small_model: "openai/gpt-5-nano",
      router: {
        enabled: true,
        mode: "observe",
        tiers: { S: "openai/gpt-5-nano" },
      },
    })
    // A V1-shaped file is detected as V1 (it carries V1 keys) and migrated.
    expect(ConfigMigrateV1.isV1(v1)).toBe(true)
    const migrated = ConfigMigrateV1.migrate(v1)
    expect(migrated.router?.enabled).toBe(true)
    expect(migrated.router?.mode).toBe("observe")
    // And the migrated output decodes through the V2 Info schema.
    const v2 = Schema.decodeUnknownSync(Config.Info)(migrated)
    expect(v2.router?.tiers?.S).toBe("openai/gpt-5-nano")
  })
})

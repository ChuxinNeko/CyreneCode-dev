/**
 * ModelRouter — intelligent, rule-based per-turn model routing.
 *
 * This is an *additive* layer over the existing single-model request path. When
 * the router config is disabled the `route` method returns a no-op decision and
 * the turn loop is byte-identical to before. The router never rewrites
 * `SessionRunnerModel.resolve`; it only recomputes a target model the turn loop
 * may adopt.
 */

export * as ModelRouter from "./service"

import { type Model } from "@opencode-ai/llm"
import { Context, Effect, Layer } from "effect"
import { Catalog } from "../catalog"
import { Config } from "../config"
import { ConfigRouter } from "../config/router"
import { makeLocationNode } from "../effect/app-node"
import { Integration } from "../integration"
import { ModelV2 } from "../model"
import { SessionSchema } from "../session/schema"
import { SessionRunnerModel } from "../session/runner/model"
import * as Budget from "./budget"
import {
  classify,
  computeFlags,
  type Flags,
  type Tier,
  TIER_ORDER,
  tierIndex,
} from "./classifier"

export interface RoutingDecision {
  readonly tier: Tier
  readonly mode: "observe" | "full"
  /** True when the router config is enabled (routing is active for this turn). */
  readonly active: boolean
  readonly baselineRef: ModelV2.Ref
  /** Target model for the chosen tier, after config + fallback + budget. */
  readonly routedRef?: ModelV2.Ref
  /** Concrete route-bound LLM model; present only when full && applied. */
  readonly routedModel?: Model
  readonly applied: boolean
  readonly reasons: readonly string[]
  readonly flags: Flags
  readonly difficulty: number
  readonly budget: "warn" | "cap" | undefined
}

export interface RouteInput {
  readonly session: SessionSchema.Info
  readonly baseline: ModelV2.Ref
  readonly text: string
  readonly turnIndex: number
}

export interface Interface {
  readonly route: (input: RouteInput) => Effect.Effect<RoutingDecision>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelRouter") {}

const noop = (baseline: ModelV2.Ref, mode: "observe" | "full"): RoutingDecision => ({
  tier: "M",
  mode,
  active: false,
  baselineRef: baseline,
  applied: false,
  reasons: [],
  flags: computeFlags("", { turnIndex: 0, depthFloor: 8 }),
  difficulty: 0,
  budget: undefined,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service

    // Bind a target model ref to a concrete route-bound LLM model. `resolve`
    // only reads `session.model?.variant`, so a bare ref shell is enough here.
    const bindModel = (
      ref: ModelV2.Ref,
      info: ModelV2.Info,
    ): Effect.Effect<Model, unknown> =>
      Effect.gen(function* () {
        const provider = yield* catalog.provider.get(ref.providerID)
        const connection = yield* integrations.connection.active(
          provider?.integrationID ?? Integration.ID.make(ref.providerID),
        )
        const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
        const shell = { id: "" as SessionSchema.ID, model: ref } as SessionSchema.Info
        return yield* SessionRunnerModel.resolve(shell, info, credential)
      })

    // Map a tier to a model ref: explicit config beats a per-tier heuristic.
    const resolveTierRef = (
      tier: Tier,
      tiers: Record<string, string> | undefined,
      baseline: ModelV2.Ref,
    ): Effect.Effect<ModelV2.Ref | undefined> => {
      const configured = tiers?.[tier]
      if (configured) {
        const parsed = ModelV2.parse(configured)
        const ref: ModelV2.Ref = { providerID: parsed.providerID, id: parsed.modelID }
        return catalog.model.get(ref.providerID, ref.id).pipe(
          Effect.map((info) => (info?.enabled ? ref : undefined)),
        )
      }
      if (tier === "M") return Effect.succeed(baseline)
      if (tier === "S") {
        return catalog.model.small(baseline.providerID).pipe(
          Effect.map((info) => (info ? { providerID: baseline.providerID, id: info.id } : undefined)),
        )
      }
      // L / XL without explicit config are disabled.
      return Effect.succeed(undefined)
    }

    // Walk the ladder downward from an intended tier to the nearest available one.
    const resolveTier = (
      intended: Tier,
      tiers: Record<string, string> | undefined,
      baseline: ModelV2.Ref,
    ): Effect.Effect<{ tier: Tier; ref: ModelV2.Ref }> => {
      const chain = TIER_ORDER.slice(0, tierIndex(intended) + 1) // e.g. XL,L,M,S
      if (chain.length === 0) return Effect.succeed({ tier: "M", ref: baseline })
      const go = (i: number): Effect.Effect<{ tier: Tier; ref: ModelV2.Ref }> => {
        if (i < 0) return Effect.succeed({ tier: "M", ref: baseline })
        return resolveTierRef(chain[i]!, tiers, baseline).pipe(
          Effect.flatMap((ref) => (ref ? Effect.succeed({ tier: chain[i]!, ref }) : go(i - 1))),
        )
      }
      return go(chain.length - 1)
    }

    const route = Effect.fn("ModelRouter.route")(function* ({ session, baseline, text, turnIndex }: RouteInput) {
      const routerCfg = Config.latest(yield* config.entries(), "router")
      const mode: "observe" | "full" = routerCfg?.mode ?? "observe"
      if (!routerCfg?.enabled) return noop(baseline, mode)

      const classification = classify({
        text,
        turnIndex,
        depthFloor: routerCfg?.depthFloor ?? 8,
      })

      // 1. Resolve the classifier's intended tier to a concrete ref (fallback chain).
      const { tier, ref } = yield* resolveTier(classification.tier, routerCfg.tiers, baseline)

      let targetRef: ModelV2.Ref | undefined = { providerID: ref.providerID, id: ref.id }
      let budgetStatus: "warn" | "cap" | undefined
      const reasons = [...classification.reasons]

      // 2. Budget gate may cap the tier (only when a ceiling is configured).
      const budgetCfg = routerCfg?.budget
      if (budgetCfg?.limitUsd && budgetCfg.limitUsd > 0) {
        const baselineInfo = yield* catalog.model.get(baseline.providerID, baseline.id)
        const targetInfo = yield* catalog.model.get(targetRef.providerID, targetRef.id)
        const info = targetInfo ?? baselineInfo
        if (info) {
          const decision = Budget.evaluateBudget({
            spentUsd: Budget.spendUsd(session.tokens, info),
            limitUsd: budgetCfg.limitUsd,
            action: budgetCfg.action ?? "warn",
            tier,
          })
          if (decision.status === "cap") {
            const capped = yield* resolveTier(Budget.CHEAP_TIER, routerCfg.tiers, baseline)
            targetRef = { providerID: capped.ref.providerID, id: capped.ref.id }
            budgetStatus = "cap"
            reasons.push("budget_cap")
          } else if (decision.status === "warn") {
            budgetStatus = "warn"
            reasons.push("budget_warn")
          }
        }
      }

      const applied =
        mode === "full" &&
        targetRef !== undefined &&
        (targetRef.providerID !== baseline.providerID || targetRef.id !== baseline.id)

      // 3. Bind the concrete model only when we will actually use it.
      let routedModel: Model | undefined
      if (applied && targetRef) {
        const info = yield* catalog.model.get(targetRef.providerID, targetRef.id)
        if (info) {
          const bound = yield* bindModel(targetRef, info).pipe(
            Effect.catch(() => Effect.succeed<Model | undefined>(undefined)),
          )
          if (bound) routedModel = bound
        }
      }

      return {
        tier,
        mode,
        active: true,
        baselineRef: baseline,
        routedRef: targetRef,
        routedModel,
        applied: applied && routedModel !== undefined,
        reasons,
        flags: classification.flags,
        difficulty: classification.difficulty,
        budget: budgetStatus,
      }
    })

    return Service.of({ route })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Catalog.node, Integration.node],
})

export * as ConfigRouter from "./router"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../schema"

export class Budget extends Schema.Class<Budget>("ConfigV2.Router.Budget")({
  limitUsd: Schema.Finite.pipe(Schema.optional).annotate({
    description: "Per-session spend ceiling in USD; once exceeded the router warns or caps the tier",
  }),
  action: Schema.Literals(["warn", "cap"]).pipe(Schema.optional).annotate({
    description: "warn = keep routing but log the overage; cap = force the cheap tier once the ceiling is hit",
  }),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Router")({
  enabled: Schema.Boolean.pipe(Schema.optional).annotate({
    description:
      "Enable intelligent model routing. When false (default) the turn loop behaves exactly as without routing.",
  }),
  mode: Schema.Literals(["observe", "full"]).pipe(Schema.optional).annotate({
    description: "observe records the would-be route and keeps the baseline model; full applies the routed model.",
  }),
  tiers: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional).annotate({
    description:
      "Tier -> 'provider/model' map (S/M/L/XL). Unset/omitted tiers fall back automatically: S=catalog small, M=baseline, L/XL disabled unless configured.",
  }),
  budget: Budget.pipe(Schema.optional),
  depthFloor: NonNegativeInt.pipe(Schema.optional).annotate({
    description: "Conversation depth at which routing forbids degrading below the M tier (default 8)",
  }),
  depthCap: PositiveInt.pipe(Schema.optional).annotate({
    description: "Optional conservative cap on how far routing may upgrade based on conversation depth alone",
  }),
}) {}

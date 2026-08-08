/**
 * Rule-based tier classifier for intelligent model routing.
 *
 * Pure functions — no IO, no runtime dependency. Ports the guardrail ideas
 * from OpenSquilla's SquillaRouter (controller.py / postprocess.py): flag
 * keyword tables, trivial-ack detection, under-routing safety, and a
 * conversation-depth floor. The router service feeds this text and applies
 * its tier choice to a concrete model.
 */

export const TIER_S = "S"
export const TIER_M = "M"
export const TIER_L = "L"
export const TIER_XL = "XL"

export type Tier = "S" | "M" | "L" | "XL"

/** Canonical tier ladder, cheapest to strongest. */
export const TIER_ORDER: readonly Tier[] = [TIER_S, TIER_M, TIER_L, TIER_XL]

export const tierIndex = (tier: Tier): number => TIER_ORDER.indexOf(tier)

export interface Flags {
  readonly highRisk: boolean
  readonly debug: boolean
  readonly longContext: boolean
  readonly strictFormat: boolean
  readonly repoArch: boolean
  readonly deepConversation: boolean
}

export const noFlags: Flags = {
  highRisk: false,
  debug: false,
  longContext: false,
  strictFormat: false,
  repoArch: false,
  deepConversation: false,
}

export interface ClassifierInput {
  readonly text: string
  readonly turnIndex: number
  readonly depthFloor: number
}

export interface Classification {
  readonly tier: Tier
  /** Human-readable reasons for the choice, in decision order. */
  readonly reasons: readonly string[]
  readonly flags: Flags
  readonly difficulty: number
  readonly trivial: boolean
}

// --- keyword tables (zh + en) -------------------------------------------------

const HIGH_RISK_KEYWORDS = [
  "deploy",
  "rollback",
  "migration",
  "migrate",
  "delete",
  "overwrite",
  "production",
  "customer-facing",
  "生产",
  "部署",
  "回滚",
  "迁移",
  "删除",
  "客户",
  "法务",
  "财务",
]

const DEBUG_KEYWORDS = [
  "error",
  "bug",
  "exception",
  "traceback",
  "failed",
  "root cause",
  "stack trace",
  "报错",
  "根因",
  "异常",
  "修复",
]

const REPO_ARCH_KEYWORDS = [
  "monorepo",
  "architecture",
  "refactor",
  "重构",
  "架构",
]

const STRICT_FORMAT_KEYWORDS = [
  "json",
  "yaml",
  "csv",
  "schema",
  "只返回",
  "不要解释",
  "按格式",
]

/** Ack words (en + zh) that mark a turn as trivial when the whole message is
 * composed of them. Token-based so "ok thanks" / "thank you" work. */
const TRIVIAL_WORDS = new Set([
  "thanks",
  "thank",
  "thx",
  "you",
  "ok",
  "okay",
  "yes",
  "no",
  "fine",
  "got",
  "it",
  "sure",
  "收到",
  "好的",
  "嗯",
  "谢谢",
  "是的",
  "知道了",
  "不用了",
  "行",
  "好",
  "明白",
])

/** Long-context thresholds (mirror OpenSquilla long_context flag). */
const LONG_CONTEXT = {
  charThreshold: 6000,
  codeBlockThreshold: 1500,
  fileRefThreshold: 2,
} as const

const DEFAULT_DEPTH_FLOOR = 8

const lower = (text: string) => text.toLowerCase()

const hasAny = (text: string, keywords: readonly string[]) => {
  const lowered = lower(text)
  return keywords.some((keyword) => lowered.includes(keyword))
}

const countCodeBlocks = (text: string) => {
  const matches = text.match(/```/g)
  return matches ? matches.length / 2 : 0
}

const countFileRefs = (text: string) => {
  const refs = text.match(/[A-Za-z0-9_./-]+\.[a-z]{1,5}(?::\d+)?(?:-\d+)?/g)
  return refs ? refs.length : 0
}

/** Strip punctuation/spaces and CJK spacing to compare ack phrases. */
export function isTrivial(text: string): boolean {
  const lowered = text.trim().toLowerCase()
  if (!lowered) return false
  // Anything carrying code-ish characters is never a pure ack.
  if (/[`{}[\]\\#*_=+<>\d]/.test(lowered)) return false
  const tokens = lowered.split(/[\s.,!?。！？，、;；:：~～]+/).filter((token) => token.length > 0)
  if (tokens.length === 0 || tokens.length > 4) return false
  return tokens.every((token) => TRIVIAL_WORDS.has(token))
}

/** 0..1 difficulty heuristic: code blocks, file refs, and raw length. */
export function estimateDifficulty(text: string): number {
  const codeBlocks = countCodeBlocks(text)
  const fileRefs = countFileRefs(text)
  const length = text.length
  const codeScore = Math.min(codeBlocks / 4, 1)
  const fileScore = Math.min(fileRefs / LONG_CONTEXT.fileRefThreshold, 1)
  const lengthScore = Math.min(length / LONG_CONTEXT.charThreshold, 1)
  return Math.max(codeScore, fileScore, lengthScore * 0.5)
}

export function computeFlags(
  text: string,
  input: { readonly turnIndex: number; readonly depthFloor: number },
): Flags {
  const longContext = text.length > LONG_CONTEXT.charThreshold
  return {
    highRisk: hasAny(text, HIGH_RISK_KEYWORDS),
    debug: hasAny(text, DEBUG_KEYWORDS),
    longContext,
    strictFormat: hasAny(text, STRICT_FORMAT_KEYWORDS),
    repoArch: hasAny(text, REPO_ARCH_KEYWORDS),
    deepConversation: input.turnIndex >= (input.depthFloor > 0 ? input.depthFloor : DEFAULT_DEPTH_FLOOR),
  }
}

export function classify(input: ClassifierInput): Classification {
  const flags = computeFlags(input.text, {
    turnIndex: input.turnIndex,
    depthFloor: input.depthFloor,
  })
  const trivial = isTrivial(input.text)
  const difficulty = estimateDifficulty(input.text)
  const reasons: string[] = []

  let tier: Tier = TIER_M

  if (trivial) {
    tier = TIER_S
    reasons.push("trivial_ack")
  }

  if (flags.strictFormat) reasons.push("strict_format")
  if (flags.longContext) reasons.push("long_context")
  if (flags.debug) reasons.push("debug")
  if (flags.repoArch) reasons.push("repo_arch")
  if (flags.highRisk) reasons.push("high_risk")
  if (flags.deepConversation) reasons.push("deep_conversation")

  // Upgrade rules: strong flags lift M up. repoArch/strictFormat alone are far
  // too common (architecture talk, "return JSON") to justify a heavier model on
  // their own — they only contribute to the severe XL signal.
  if (flags.highRisk && (flags.debug || flags.longContext || flags.repoArch || flags.strictFormat)) {
    tier = TIER_XL
    reasons.push("severe_risk_upgrade")
  } else if (flags.highRisk || flags.longContext || flags.debug) {
    tier = TIER_L
    reasons.push("flag_upgrade")
  }

  // Under-routing safety: never let the cheap tier own a load-bearing message
  // (coded / file-referencing / long enough to carry real work). Defensive,
  // since the S tier only arises from a pure ack that normally carries no code.
  if (tier === TIER_S && difficulty >= 0.5) {
    tier = TIER_M
    reasons.push("under_routing_safety")
  }

  // Conversation-depth floor: never run the cheap tier once the session is deep.
  if (flags.deepConversation && tier === TIER_S) {
    tier = TIER_M
    reasons.push("depth_floor")
  }

  return { tier, reasons, flags, difficulty, trivial }
}

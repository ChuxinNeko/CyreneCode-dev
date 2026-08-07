// Shared types describing a desktop pet and its sprite animation metadata.
// These are the single source of truth for pet shapes across the app
// (settings UI / platform abstraction) and the desktop layer (main process,
// preload bridge and the standalone pet renderer window).

export type PetAnimationName = "idle" | "walk" | "react" | "jump" | "failed" | "waiting" | "running" | "review"

export type PetFrameLayout = {
  /** Width of a single frame in pixels. */
  width: number
  /** Height of a single frame in pixels. */
  height: number
  /** Number of frame columns in the spritesheet. */
  columns: number
  /** Number of frame rows in the spritesheet. */
  rows: number
}

export type PetAnimation = {
  /** Frame indices into the spritesheet, played in order. */
  frames: number[]
  /** Playback speed in frames per second. */
  fps: number
  /** Whether the animation loops or plays once. */
  loop: boolean
}

export type PetManifest = {
  id: string
  displayName: string
  description: string
  /** Path of the spritesheet relative to the pet directory. */
  spritesheetPath: string
  /**
   * Codex pet package version. Absent/1 = 9 animation rows (1536x1872),
   * 2 = 11 rows (1536x2288, adds look-direction rows). Informational only;
   * the renderer derives the real grid from the image itself.
   */
  spriteVersionNumber?: number
  /**
   * Explicit frame layout. Optional: Codex-style pet packages omit it and the
   * renderer auto-detects the grid from the spritesheet's alpha gutters.
   */
  frame?: PetFrameLayout
  /**
   * Explicit animation definitions. Optional: when omitted, animations are
   * derived from the spritesheet rows following the Codex row convention
   * (row 0 idle, row 1 run-right, row 2 run-left, row 3 react, row 4 jump,
   * row 5 failed, row 6 waiting, row 7 running, row 8 review), using each
   * row's run of consecutive non-empty frames. Entries present here always
   * win over the auto-detected ones.
   */
  animations?: Partial<Record<PetAnimationName, PetAnimation>>
}

/** Lightweight character summary used by the settings character picker.
 *  `id` is the **directory name** — the canonical key used by every lookup
 *  (asset protocol, window URL, manifest read). It is NOT the manifest `id`
 *  field, which is arbitrary and may differ from the folder name. */
export type PetCharacterInfo = {
  id: string
  displayName: string
  description: string
}

/** Persisted desktop pet configuration. */
export type PetConfig = {
  enabled: boolean
  character: string
}

/** Context events the host app can push to the pet to drive its animations.
 *  Mapped by the renderer to spritesheet rows per the Codex convention:
 *   thinking→row6 (waiting), running→row7, success→row4 (jump),
 *   error→row5 (failed), review→row8, idle→revert to the idle state. */
export type PetEventName = "thinking" | "running" | "success" | "error" | "review" | "idle"
export type PetEvent = { name: PetEventName }

/** Rectangle describing the work area the pet may walk within. */
export type PetWorkArea = {
  x: number
  y: number
  width: number
  height: number
}

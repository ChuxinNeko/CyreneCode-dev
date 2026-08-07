// Standalone desktop pet renderer. Draws a sprite-sheet character onto a
// transparent, always-on-top window. Supports idle animation, dragging, click
// reactions and periodic auto-walking within the display work area.
//
// This file intentionally avoids the Solid runtime: it is a tiny canvas loop
// that talks to the main process through the preload `window.api` bridge.
//
// === Why we draw the way we do ===
// The spritesheet has an alpha channel (the character floats on transparent
// pixels) and the window itself is transparent. Three facts drive the
// rendering strategy:
//   1. Ghosting: frames have transparent areas, so naively drawImage-ing the
//      next frame over the previous one leaves the old frame showing through.
//      We must replace the whole previous frame every time.
//   2. Flash: clearRect on the VISIBLE canvas is not atomic with the next
//      draw — the OS compositor can sample the cleared (fully transparent)
//      frame, which presents as the whole pet vanishing for a beat. This was
//      most visible at animation loop boundaries (frame N → frame 0 and
//      mode switches). So the visible canvas is never cleared.
//   3. The fix: double buffering with the "copy" composite op. Each tick we
//      compose the complete frame — clear + sprite — on an OFFSCREEN canvas
//      (clearing offscreen is always safe), then blit it onto the visible
//      canvas with globalCompositeOperation = "copy", which overwrites the
//      destination including its alpha channel in ONE atomic draw call.
//      Result: true transparency (no opaque backing rectangle), no ghosting,
//      and no flash, because the compositor only ever sees fully composed
//      frames.
//   4. WebP decoders sometimes leave junk RGB (a purple tint) on fully-
//      transparent pixels. We scrub that at load time so no purple edge shows.

import type { PetAnimation, PetAnimationName, PetEvent, PetManifest, PetWorkArea } from "@opencode-ai/app"

const PET_ASSET_SCHEME = "oc-pet"
const PET_ASSET_HOST = "pet"
// Pixels the pet walks per animation tick.
const WALK_SPEED = 1.4
// Pointer travel below this distance is treated as a click, not a drag.
const DRAG_THRESHOLD = 5

const character = new URLSearchParams(window.location.search).get("character") ?? "taffy"

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Pet renderer root not found")

const canvas = document.createElement("canvas")
canvas.style.display = "block"
canvas.style.width = "100%"
canvas.style.height = "100%"
// The window is fully transparent; ensure the canvas never captures a
// background of its own.
canvas.style.background = "transparent"
rootEl.appendChild(canvas)
const context2d = canvas.getContext("2d")
if (!context2d) throw new Error("Canvas 2D context unavailable")
const ctx = context2d

// Offscreen frame buffer. Each tick the complete frame (clear + sprite) is
// composed here, then blitted onto the visible canvas with the "copy"
// composite op — a single atomic draw that replaces the destination pixels
// INCLUDING alpha. This keeps the window truly transparent (no opaque
// backing), avoids ghosting, and never presents a half-cleared frame.
const buffer = document.createElement("canvas")
const bufferContext2d = buffer.getContext("2d")
if (!bufferContext2d) throw new Error("Buffer 2D context unavailable")
const bctx = bufferContext2d

let manifest: PetManifest | null = null
// Pre-processed spritesheet (a canvas) so we can scrub the "purple edge"
// artifact that some WebP decoders leave on fully-transparent pixels.
let sheet: CanvasImageSource | null = null
let columns = 8
let frameWidth = 192
let frameHeight = 208
// Default cell size, also the Codex pet spec cell size — so Codex packages
// never trigger a window resize after auto-detection.
const DEFAULT_FRAME_WIDTH = 192
const DEFAULT_FRAME_HEIGHT = 208

type Mode = PetAnimationName
let mode: Mode = "idle"
// Resolved animation table: auto-detected from the spritesheet rows, with
// explicit manifest.animations entries overriding per mode.
let animations: Partial<Record<PetAnimationName, PetAnimation>> = {}
// Dedicated run-left frames (Codex row 2). When present, leftward walking
// plays them directly instead of mirroring the rightward frames.
let walkLeftFrames: number[] | null = null
let currentFrames: number[] = []
let currentFps = 6
let currentLoop = true
let frameIndex = 0
let lastFrameTs = 0
// Facing direction used while walking (-1 flips the sprite horizontally).
let direction: 1 | -1 = 1

// Auto-walk state.
let autoWalkEnabled = true
let nextWalkAt = Number.POSITIVE_INFINITY
let walkUntil = 0
let walkDirection: 1 | -1 = 1
let workArea: PetWorkArea | null = null
let walkPos: { x: number; y: number } | null = null

// Persistent (background) state that one-shot animations return to. Sticky
// modes loop and hold; one-shots play once then fall back to this.
let persistentMode: Mode = "idle"
let returnMode: Mode = "idle"
// Ambient-triggered sticky modes (waiting/running) auto-revert after this.
let stickyAuto = false
let stickyUntil = 0
// Next time the idle ambient-variation picker may fire.
let nextAmbientAt = 0
// Last pointer-up timestamp, for double-click detection (→ jump).
let lastClickAt = 0

// Sticky modes persist (loop / hold) and become the mode one-shots return to.
const STICKY_MODES = new Set<PetAnimationName>(["idle", "walk", "waiting", "running"])

let cssWidth = 0
let cssHeight = 0

function assetUrl(file: string) {
  return `${PET_ASSET_SCHEME}://${PET_ASSET_HOST}/${encodeURIComponent(character)}/${file}`
}

// Loads the spritesheet, decodes it, and pre-processes transparent pixels so
// the WebP "purple edge" artifact (junk RGB left on fully-transparent pixels)
// is gone. Resolves to a canvas we can drawImage from. Loads with CORS first
// so the canvas stays readable — grid/animation auto-detection needs pixel
// access (the oc-pet protocol explicitly allows any origin).
function loadSheet(src: string, useCors: boolean = true): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (useCors) img.crossOrigin = "anonymous"
    img.decoding = "async"
    img.onload = () => {
      const run = () => {
        const w = img.naturalWidth
        const h = img.naturalHeight
        const off = document.createElement("canvas")
        off.width = w
        off.height = h
        const octx = off.getContext("2d")
        if (!octx) {
          reject(new Error("offscreen 2D context unavailable"))
          return
        }
        octx.drawImage(img, 0, 0)
        try {
          const data = octx.getImageData(0, 0, w, h)
          const px = data.data
          // Fully-transparent pixels: clear any leftover RGB (kills purple
          // edge). Pixels with real (anti-aliased) alpha are left alone.
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 8) {
              px[i] = 0
              px[i + 1] = 0
              px[i + 2] = 0
            }
          }
          octx.putImageData(data, 0, 0)
        } catch {
          // Tainted canvas (e.g. CORS) — fall back to the raw image without
          // cleanup. The purple edge may remain but animation still works.
        }
        resolve(off)
      }
      if (typeof img.decode === "function") {
        img.decode().then(run).catch(run)
      } else {
        run()
      }
    }
    img.onerror = () => {
      // CORS mode failed (e.g. a non-compliant asset host) — retry plainly.
      // The sheet still renders; pixel-based auto-detection will be skipped.
      if (useCors) {
        loadSheet(src, false).then(resolve, reject)
        return
      }
      reject(new Error("spritesheet load failed"))
    }
    img.src = src
  })
}

// ── Spritesheet auto-detection ──────────────────────────────────────
// Codex pet packages ship a pet.json WITHOUT any frame/animation metadata —
// the layout is derived from the image itself:
//   1. Grid: fast-path the Codex spec atlas sizes (1536x1872 = 8x9 and
//      1536x2288 = 8x11, both 192x208 cells). Otherwise scan candidate grids
//      and pick the FINEST one whose cell boundaries fall on fully
//      transparent "gutters". Sprite cells always keep transparent margins,
//      so a correct grid's boundaries cross zero opaque pixels, while a wrong
//      (or finer) grid slices through sprites and scores gutter hits.
//      Coarser grids whose boundaries are a subset of the true grid's also
//      test clean, hence "finest wins", not "fewest hits wins".
//   2. Frames: per the Codex spec, each row plays the run of consecutive
//      non-empty cells starting at column 0; trailing empty cells are
//      ignored (rows simply have different frame counts).
//   3. Row semantics (Codex): row 0 = idle, row 1 = run right, row 2 = run
//      left, row 3 = react/waving, row 4 = jump, row 5 = failed, row 6 =
//      waiting, row 7 = running, row 8 = review. Rows 0-8 all drive animations;
//      the renderer plays idle (row 0) by default, walk (rows 1-2) on its own
//      timer, react (row 3) on click, and the rest (rows 4-8) via ambient idle
//      variation or host-app context events (window.api.petNotify:
//      think/run/success/error/review/idle). Explicit entries always win.
// Explicit manifest.frame / manifest.animations entries always win.

// A pixel counts as content at or above this alpha (matches the scrub).
const ALPHA_OPAQUE = 8

type SheetGrid = { frameWidth: number; frameHeight: number; columns: number; rows: number }
type SheetPixels = { px: Uint8ClampedArray; width: number; height: number }

function readSheetPixels(source: CanvasImageSource): SheetPixels | null {
  if (!(source instanceof HTMLCanvasElement)) return null
  const context = source.getContext("2d")
  if (!context) return null
  try {
    const data = context.getImageData(0, 0, source.width, source.height)
    return { px: data.data, width: source.width, height: source.height }
  } catch {
    // Tainted canvas (CORS-less fallback load) — no pixel access.
    return null
  }
}

function detectGrid(pixels: SheetPixels): SheetGrid {
  const { px, width, height } = pixels
  // Codex spec fast paths.
  if (width === 1536 && height === 1872) return { frameWidth: 192, frameHeight: 208, columns: 8, rows: 9 }
  if (width === 1536 && height === 2288) return { frameWidth: 192, frameHeight: 208, columns: 8, rows: 11 }

  // Column/row opaque profiles (sampled every 2px) so every candidate grid
  // can test its boundary lines without rescanning the image.
  const colHits = new Uint32Array(width)
  const rowHits = new Uint32Array(height)
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (px[(y * width + x) * 4 + 3] >= ALPHA_OPAQUE) {
        colHits[x]++
        rowHits[y]++
      }
    }
  }
  // A boundary is clean when its +/-2px band holds no opaque pixel.
  const cleanBand = (profile: Uint32Array, at: number, max: number) => {
    for (let i = Math.max(0, at - 2); i <= Math.min(max - 1, at + 2); i++) {
      if (profile[i] > 0) return false
    }
    return true
  }

  let best: (SheetGrid & { dirty: number }) | null = null
  for (let cols = 2; cols <= 24; cols++) {
    if (width % cols !== 0) continue
    const candidateWidth = width / cols
    if (candidateWidth < 48 || candidateWidth > 512) continue
    for (let rows = 1; rows <= 24; rows++) {
      if (height % rows !== 0) continue
      const candidateHeight = height / rows
      if (candidateHeight < 48 || candidateHeight > 512) continue
      let dirty = 0
      for (let c = 1; c < cols; c++) if (!cleanBand(colHits, c * candidateWidth, width)) dirty++
      for (let r = 1; r < rows; r++) if (!cleanBand(rowHits, r * candidateHeight, height)) dirty++
      // Prefer the fewest dirty boundaries; among equally clean grids prefer
      // the finest (coarser subdivisions of the true grid also test clean).
      if (!best || dirty < best.dirty || (dirty === best.dirty && cols * rows > best.columns * best.rows)) {
        best = { frameWidth: candidateWidth, frameHeight: candidateHeight, columns: cols, rows, dirty }
      }
    }
  }
  return best ?? { frameWidth: width, frameHeight: height, columns: 1, rows: 1 }
}

// Per-row runs of consecutive non-empty cells from column 0 (Codex playback
// rule): each entry is the list of frame indices that row actually contains.
function detectRowRuns(pixels: SheetPixels, grid: SheetGrid): number[][] {
  const { px, width } = pixels
  const { frameWidth, frameHeight, columns, rows } = grid
  const result: number[][] = []
  for (let r = 0; r < rows; r++) {
    const run: number[] = []
    for (let c = 0; c < columns; c++) {
      let opaque = 0
      const x0 = c * frameWidth
      const y0 = r * frameHeight
      for (let y = y0; y < y0 + frameHeight; y += 4) {
        for (let x = x0; x < x0 + frameWidth; x += 4) {
          if (px[(y * width + x) * 4 + 3] >= ALPHA_OPAQUE) opaque++
        }
      }
      if (opaque < 8) break
      run.push(r * columns + c)
    }
    result.push(run)
  }
  return result
}

function resolveGrid(source: HTMLCanvasElement): SheetGrid {
  const explicit = manifest?.frame
  if (explicit?.width && explicit?.height && explicit?.columns) {
    return {
      frameWidth: explicit.width,
      frameHeight: explicit.height,
      columns: explicit.columns,
      rows: explicit.rows || Math.max(1, Math.round(source.height / explicit.height)),
    }
  }
  const pixels = readSheetPixels(source)
  if (!pixels) {
    // No pixel access: spec-size fast path, else treat as a single frame.
    if (source.width % DEFAULT_FRAME_WIDTH === 0 && source.height % DEFAULT_FRAME_HEIGHT === 0) {
      return {
        frameWidth: DEFAULT_FRAME_WIDTH,
        frameHeight: DEFAULT_FRAME_HEIGHT,
        columns: source.width / DEFAULT_FRAME_WIDTH,
        rows: source.height / DEFAULT_FRAME_HEIGHT,
      }
    }
    return { frameWidth: source.width, frameHeight: source.height, columns: 1, rows: 1 }
  }
  return detectGrid(pixels)
}

function resolveAnimations(source: HTMLCanvasElement, grid: SheetGrid) {
  const auto: Partial<Record<PetAnimationName, PetAnimation>> = {}
  let autoWalkLeft: number[] | null = null
  const pixels = readSheetPixels(source)
  if (pixels) {
    const rows = detectRowRuns(pixels, grid)
    const run = (r: number) => (r < rows.length && rows[r].length > 0 ? rows[r] : null)
    const idle = run(0)
    if (idle) auto.idle = { frames: idle, fps: 6, loop: true }
    const walkRight = run(1)
    if (walkRight) auto.walk = { frames: walkRight, fps: 12, loop: true }
    autoWalkLeft = run(2)
    const react = run(3)
    if (react) auto.react = { frames: react, fps: 10, loop: false }
    const jump = run(4)
    if (jump) auto.jump = { frames: jump, fps: 10, loop: false }
    const failed = run(5)
    if (failed) auto.failed = { frames: failed, fps: 8, loop: false }
    const waiting = run(6)
    if (waiting) auto.waiting = { frames: waiting, fps: 6, loop: true }
    const running = run(7)
    if (running) auto.running = { frames: running, fps: 12, loop: true }
    const review = run(8)
    if (review) auto.review = { frames: review, fps: 6, loop: false }
  }
  const explicit = manifest?.animations ?? {}
  // Dedicated run-left frames only apply when the walk cycle itself was
  // auto-detected. An explicit walk list (like Taffy's 16-frame cycle
  // spanning rows 1-2) keeps the mirror-flip behaviour instead.
  const resolvedWalkLeft = explicit.walk ? null : autoWalkLeft
  return { animations: { ...auto, ...explicit }, walkLeftFrames: resolvedWalkLeft }
}

function resize() {
  const dpr = window.devicePixelRatio || 1
  cssWidth = window.innerWidth
  cssHeight = window.innerHeight
  // Pin the canvas to the window size in CSS pixels. Relying on the
  // width/height: 100% stylesheet rules alone can leave the backing store
  // mismatched with the window on HiDPI setups, which makes the sprite drift
  // or the transparent area look wrong.
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  const nextWidth = Math.max(1, Math.round(cssWidth * dpr))
  const nextHeight = Math.max(1, Math.round(cssHeight * dpr))
  // Reallocating the backing store CLEARS the canvas. Skip it when the size
  // has not actually changed (Windows can fire resize events for sub-pixel
  // oscillations on fractional-DPI displays), otherwise each stray event
  // would wipe the sprite and the transparent window would flash blank.
  const reallocated = canvas.width !== nextWidth || canvas.height !== nextHeight
  if (reallocated) {
    canvas.width = nextWidth
    canvas.height = nextHeight
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  // The offscreen buffer mirrors the visible canvas exactly (same backing
  // size, same transform) so the final "copy" blit is a 1:1 pixel transfer.
  buffer.width = canvas.width
  buffer.height = canvas.height
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  bctx.imageSmoothingEnabled = false
  // After a real reallocation the canvas is blank; repaint the current frame
  // synchronously, inside this same handler, so the compositor never gets a
  // chance to present the cleared canvas.
  if (reallocated) draw()
}

// Switches the active animation. Sticky modes (idle/walk/waiting/running) are
// persistent: they become the mode one-shots fall back to. One-shot modes
// (react/jump/failed/review) play once and then return to `persistentMode`.
function setMode(next: Mode, now: number = performance.now()) {
  const anim: PetAnimation | undefined = animations[next]
  if (!anim || !anim.frames?.length) return
  if (STICKY_MODES.has(next)) {
    persistentMode = next
  } else {
    returnMode = persistentMode
  }
  mode = next
  currentFrames = anim.frames
  currentFps = anim.fps > 0 ? anim.fps : 6
  currentLoop = anim.loop !== false
  frameIndex = 0
  lastFrameTs = now
}

function scheduleNextWalk(now: number) {
  nextWalkAt = now + 4000 + Math.random() * 9000
}

async function beginWalk(now: number) {
  const [position, area] = await Promise.all([window.api.petGetPosition(), window.api.petGetWorkArea()])
  if (!position) {
    scheduleNextWalk(now)
    return
  }
  workArea = area
  walkPos = { x: position[0], y: position[1] }
  walkDirection = Math.random() < 0.5 ? -1 : 1
  setMode("walk", now)
  walkUntil = now + 2500 + Math.random() * 4000
}

function endWalk(now: number) {
  setMode("idle", now)
  walkPos = null
  scheduleNextWalk(now)
}

function stepWalk() {
  if (!workArea || !walkPos) return
  const winWidth = window.outerWidth || cssWidth
  const minX = workArea.x
  const maxX = workArea.x + workArea.width - winWidth
  if (maxX <= minX) return
  let nextX = walkPos.x + walkDirection * WALK_SPEED
  if (nextX <= minX) {
    walkDirection = 1
    nextX = minX
  } else if (nextX >= maxX) {
    walkDirection = -1
    nextX = maxX
  }
  walkPos.x = nextX
  void window.api.petSetPosition(nextX, walkPos.y)
}

// Draws a single sprite frame from `frames[idx]` onto context `c`. Walking
// left plays the dedicated run-left row when one was detected (Codex row 2);
// otherwise the rightward frames are mirrored horizontally.
function drawFrameTo(c: CanvasRenderingContext2D, img: CanvasImageSource, frames: number[], idx: number, m: Mode) {
  const left = m === "walk" && walkDirection === -1
  const active = left && walkLeftFrames && walkLeftFrames.length > 0 ? walkLeftFrames : frames
  if (active.length === 0) return
  const frameNumber = active[((idx % active.length) + active.length) % active.length] ?? 0
  const col = frameNumber % columns
  const row = Math.floor(frameNumber / columns)
  const sx = col * frameWidth
  const sy = row * frameHeight
  const dx = Math.round((cssWidth - frameWidth) / 2)
  const dy = Math.round((cssHeight - frameHeight) / 2)
  c.save()
  if (left && active === frames) {
    c.translate(cssWidth, 0)
    c.scale(-1, 1)
    c.drawImage(img, sx, sy, frameWidth, frameHeight, cssWidth - dx - frameWidth, dy, frameWidth, frameHeight)
  } else {
    c.drawImage(img, sx, sy, frameWidth, frameHeight, dx, dy, frameWidth, frameHeight)
  }
  c.restore()
}

function draw() {
  if (!sheet || currentFrames.length === 0) return

  // 1) Compose the complete frame offscreen. Clearing the offscreen buffer is
  //    always safe — it is never composited to the screen directly.
  bctx.clearRect(0, 0, cssWidth, cssHeight)
  drawFrameTo(bctx, sheet, currentFrames, frameIndex, mode)

  // 2) Blit the composed frame onto the visible canvas in ONE atomic draw
  //    with the "copy" composite op, which overwrites the destination pixels
  //    including their alpha. No clearRect on the visible canvas, so the
  //    compositor never samples a cleared frame (no flash), and no opaque
  //    backing is needed (true transparency), while the previous frame is
  //    fully replaced (no ghosting).
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = "copy"
  ctx.drawImage(buffer, 0, 0)
  ctx.restore()
}

// Advances the sprite frame by one step, handling loop wraparound and the
// transition out of a play-once animation. Never leaves the renderer in a
// frame-less state, so the pet cannot disappear at an animation boundary.
function advanceFrame(now: number) {
  if (frameIndex + 1 < currentFrames.length) {
    frameIndex++
    return
  }
  if (currentLoop) {
    frameIndex = 0
    return
  }
  // Play-once animation finished: hand control back to the persistent mode
  // (idle, walk, waiting or running) it interrupted. setMode resets
  // frameIndex/lastFrameTs for the next cycle. The pet can never be left in a
  // frame-less state, so it never disappears at an animation boundary.
  if (mode !== persistentMode) {
    setMode(persistentMode, now)
  }
}

// While idle, occasionally play one of the context animations (rows 4-8) so
// the pet stays lively without any host-app wiring. Sticky picks (waiting/
// running) auto-revert after a short beat; one-shots fall back to idle on
// their own. Each pet only gets the rows its spritesheet actually contains.
function triggerAmbient(now: number) {
  const pool: PetAnimationName[] = []
  if (animations.jump) pool.push("jump", "jump")
  if (animations.review) pool.push("review", "review")
  if (animations.failed) pool.push("failed")
  if (animations.waiting) pool.push("waiting")
  if (animations.running) pool.push("running")
  if (pool.length === 0) {
    nextAmbientAt = now + 20000
    return
  }
  const pick = pool[Math.floor(Math.random() * pool.length)]
  if (pick === "waiting" || pick === "running") {
    setMode(pick, now)
    stickyAuto = true
    stickyUntil = now + 2500 + Math.random() * 2000
  } else {
    setMode(pick, now)
  }
  nextAmbientAt = now + 15000 + Math.random() * 25000
}

// Host-app context events (pushed via window.api.petNotify) drive animations.
function handlePetEvent(event: PetEvent, now: number) {
  switch (event.name) {
    case "thinking":
      if (animations.waiting) {
        setMode("waiting", now)
        stickyAuto = false
      }
      break
    case "running":
      if (animations.running) {
        setMode("running", now)
        stickyAuto = false
      }
      break
    case "success":
      if (animations.jump) setMode("jump", now)
      break
    case "error":
      if (animations.failed) setMode("failed", now)
      break
    case "review":
      if (animations.review) setMode("review", now)
      break
    case "idle":
      setMode("idle", now)
      break
  }
}

function tick(now: number) {
  // State transitions.
  if (mode === "idle") {
    if (autoWalkEnabled && Number.isFinite(nextWalkAt) && now >= nextWalkAt) {
      nextWalkAt = Number.POSITIVE_INFINITY
      void beginWalk(now)
    } else if (now >= nextAmbientAt) {
      triggerAmbient(now)
    }
  } else if (mode === "walk") {
    if (now >= walkUntil) endWalk(now)
    else stepWalk()
  } else if (stickyAuto && (mode === "waiting" || mode === "running") && now >= stickyUntil) {
    // An ambient-triggered status animation auto-reverts to idle.
    setMode("idle", now)
  }

  // Advance the sprite frame on a fixed clock. The remainder is carried into
  // lastFrameTs so playback speed does not drift, and multiple steps can be
  // taken at once so a throttled rAF (e.g. after the window was occluded)
  // catches up instead of stalling on a stale frame.
  if (currentFrames.length > 0) {
    const interval = 1000 / currentFps
    if (now - lastFrameTs >= interval) {
      const steps = Math.min(Math.floor((now - lastFrameTs) / interval), currentFrames.length)
      lastFrameTs += steps * interval
      for (let i = 0; i < steps; i++) advanceFrame(now)
    }
  }

  draw()
  requestAnimationFrame(tick)
}

// ── Pointer interaction: drag vs click ──────────────────────────────
let pointerDown = false
let dragging = false
let downX = 0
let downY = 0

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return
  pointerDown = true
  dragging = false
  downX = event.screenX
  downY = event.screenY
  canvas.setPointerCapture(event.pointerId)
})

canvas.addEventListener("pointermove", (event) => {
  if (!pointerDown) return
  const moved = Math.hypot(event.screenX - downX, event.screenY - downY)
  if (!dragging && moved >= DRAG_THRESHOLD) {
    dragging = true
    // Stop any in-flight walk so the drag takes over cleanly.
    if (mode === "walk") {
      setMode("idle", performance.now())
      walkPos = null
    }
    void window.api.petDragStart()
  }
  if (dragging) {
    void window.api.petDragMove(event.screenX, event.screenY)
  }
})

canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown) return
  pointerDown = false
  canvas.releasePointerCapture(event.pointerId)
  if (dragging) {
    dragging = false
    void window.api.petDragEnd()
    scheduleNextWalk(performance.now())
    return
  }
  // A short press with no movement is a click. A double-click celebrates with
  // a jump (row 4); a single click waves (row 3, react). The jump overrides
  // the wave if a second click lands within the double-click window.
  const now = performance.now()
  const isDouble = now - lastClickAt < 300
  lastClickAt = now
  if (isDouble) {
    if (animations.jump) setMode("jump", now)
    else if (animations.react) setMode("react", now)
  } else if (animations.react) {
    setMode("react", now)
  }
})

canvas.addEventListener("pointercancel", () => {
  if (dragging) void window.api.petDragEnd()
  pointerDown = false
  dragging = false
})

// ── Bootstrap ───────────────────────────────────────────────────────
async function start() {
  resize()
  window.addEventListener("resize", resize)

  try {
    const response = await fetch(assetUrl("pet.json"))
    manifest = (await response.json()) as PetManifest
  } catch {
    manifest = null
  }

  // Auto-detection needs the decoded pixels, so the sheet is loaded BEFORE
  // the initial mode is chosen. Until this resolves the window stays empty
  // (fully transparent), never a placeholder box.
  const spritePath = manifest?.spritesheetPath ?? "spritesheet.webp"
  try {
    sheet = await loadSheet(assetUrl(spritePath))
  } catch {
    sheet = null
  }

  if (sheet instanceof HTMLCanvasElement) {
    const grid = resolveGrid(sheet)
    frameWidth = grid.frameWidth
    frameHeight = grid.frameHeight
    columns = grid.columns
    const resolved = resolveAnimations(sheet, grid)
    animations = resolved.animations
    walkLeftFrames = resolved.walkLeftFrames
    // The main process sized the window from the manifest (or the Codex
    // default 192x208) before any pixels were available. If auto-detection
    // found a different cell size, ask it to resize the overlay once.
    if (!manifest?.frame && (frameWidth !== DEFAULT_FRAME_WIDTH || frameHeight !== DEFAULT_FRAME_HEIGHT)) {
      void window.api.petSetContentSize?.(frameWidth, frameHeight)
    }
  } else {
    animations = manifest?.animations ?? {}
    if (manifest?.frame) {
      frameWidth = manifest.frame.width || frameWidth
      frameHeight = manifest.frame.height || frameHeight
      columns = manifest.frame.columns || columns
    }
  }

  setMode("idle")
  scheduleNextWalk(performance.now())
  // First idle variation may fire after a short grace period.
  nextAmbientAt = performance.now() + 12000 + Math.random() * 15000
  // Host-app context events (think/run/success/error/review/idle) drive rows
  // 4-8. Falls back to the ambient idle variation when no app is wired up.
  window.api.petOnEvent?.((event: PetEvent) => handlePetEvent(event, performance.now()))

  requestAnimationFrame(tick)
}

void start()

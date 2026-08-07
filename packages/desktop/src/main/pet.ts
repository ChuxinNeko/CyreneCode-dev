import { app, BrowserWindow, net, protocol, screen } from "electron"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { PetCharacterInfo, PetConfig, PetEvent, PetManifest, PetWorkArea } from "@opencode-ai/app"
import { write as writeLog } from "./logging"
import { getStore } from "./store"
import { PET_CHARACTER_KEY, PET_ENABLED_KEY, PET_POSITION_KEY } from "./store-keys"
import { exemptFromBackgroundSync, loadWindow } from "./windows"

const root = dirname(fileURLToPath(import.meta.url))
const PET_PROTOCOL = "oc-pet"
const PET_HOST = "pet"
const DEFAULT_CHARACTER = "taffy"
// Extra margin around the sprite so bobbing/walk cycles never clip at the edge.
const WINDOW_PADDING = 8
// Default cell size, also the Codex pet spec cell size (192x208). Shared with
// the renderer so a standard Codex package never triggers a content-size
// change after auto-detection.
const DEFAULT_FRAME_WIDTH = 192
const DEFAULT_FRAME_HEIGHT = 208
// Current pet window outer size (frame + padding). Shared between the resize
// guard and the renderer-driven content-size update so a non-standard
// spritesheet can resize the overlay without the guard snapping it back.
let petWidth = DEFAULT_FRAME_WIDTH + WINDOW_PADDING * 2
let petHeight = DEFAULT_FRAME_HEIGHT + WINDOW_PADDING * 2

let petWindow: BrowserWindow | null = null
let dragOffset: { x: number; y: number } | null = null
let persistTimer: NodeJS.Timeout | undefined

// ── Asset resolution ────────────────────────────────────────────────
// Packaged builds copy packages/pet into resources/pet via electron-builder
// extraResources; dev resolves straight to the source directory.
function petAssetsDir() {
  return app.isPackaged ? join(process.resourcesPath, "pet") : join(root, "../../../pet")
}

function petDir(character: string) {
  return join(petAssetsDir(), character)
}

export function registerPetProtocol() {
  if (protocol.isProtocolHandled(PET_PROTOCOL)) return

  protocol.handle(PET_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    if (url.host !== PET_HOST) return new Response("Not found", { status: 404 })

    const base = petAssetsDir()
    const file = resolve(base, `.${decodeURIComponent(url.pathname)}`)
    const rel = relative(base, file)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      writeLog("pet", "rejected asset path", { url: request.url, file }, "warn")
      return new Response("Not found", { status: 404 })
    }

    try {
      const response = await net.fetch(pathToFileURL(file).toString())
      if (response.status >= 400) return new Response("Not found", { status: 404 })
      // The pet window is always cross-origin relative to this scheme
      // (http://localhost in dev, oc://renderer when packaged), so every
      // response must explicitly allow it.
      const headers = new Headers(response.headers)
      headers.set("access-control-allow-origin", "*")
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch (error) {
      writeLog("pet", "asset fetch error", { url: request.url, file, error }, "error")
      return new Response("Not found", { status: 404 })
    }
  })
}

export function readPetManifest(character: string): PetManifest | null {
  try {
    const raw = readFileSync(join(petDir(character), "pet.json"), "utf8")
    const manifest = JSON.parse(raw) as PetManifest
    if (!manifest || typeof manifest.id !== "string") return null
    return manifest
  } catch {
    return null
  }
}

export function listPetCharacters(): PetCharacterInfo[] {
  const base = petAssetsDir()
  if (!existsSync(base)) return []
  const characters: PetCharacterInfo[] = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = readPetManifest(entry.name)
    if (!manifest) continue
    // The directory name is the canonical character key — every downstream
    // lookup (readPetManifest, petDir, the oc-pet protocol path, the
    // `?character=` window URL) keys off the filesystem directory, NOT the
    // manifest `id`. Codex-format pets ship an arbitrary `id` that need not
    // match the folder (e.g. "xiao-xilian" in a "cyrene" folder), so using
    // `id` here would make the picker point at a non-existent directory and
    // the selection become a silent no-op. The manifest `id` is only kept for
    // display/identity, never as the selection key.
    characters.push({
      id: entry.name,
      displayName: manifest.displayName || manifest.id,
      description: manifest.description ?? "",
    })
  }
  return characters
}

// ── Config persistence ──────────────────────────────────────────────
export function getPetConfig(): PetConfig {
  const store = getStore()
  const character = store.get(PET_CHARACTER_KEY)
  return {
    enabled: store.get(PET_ENABLED_KEY) === true,
    character: typeof character === "string" && character.length > 0 ? character : DEFAULT_CHARACTER,
  }
}

export function setPetEnabled(enabled: boolean) {
  getStore().set(PET_ENABLED_KEY, enabled)
  syncPetWindow()
}

export function setPetCharacter(character: string) {
  if (!readPetManifest(character)) return
  getStore().set(PET_CHARACTER_KEY, character)
  if (getPetConfig().enabled) {
    closePetWindow()
    openPetWindow(character)
  }
}

// ── Position persistence ────────────────────────────────────────────
type PetPosition = { x: number; y: number }

function readPetPosition(): PetPosition | null {
  const value = getStore().get(PET_POSITION_KEY) as PetPosition | undefined
  if (value && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y }
  return null
}

function persistPetPosition() {
  const win = getPetWindow()
  if (!win) return
  const [x, y] = win.getPosition()
  getStore().set(PET_POSITION_KEY, { x, y })
}

function schedulePersistPosition() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = undefined
    persistPetPosition()
  }, 500)
}

function defaultPetPosition(width: number, height: number): PetPosition {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - width - 48,
    y: area.y + area.height - height - 48,
  }
}

// Snaps a position back inside the nearest display's work area. Display
// resolution, scaling or layout can change between sessions, leaving a
// persisted position stranded off-screen. Clamping is based on the window's
// center so multi-monitor layouts settle on the display it actually sits on.
function clampPetPosition(position: PetPosition, width: number, height: number): PetPosition {
  const display = screen.getDisplayNearestPoint({
    x: position.x + Math.round(width / 2),
    y: position.y + Math.round(height / 2),
  })
  const area = display.workArea

  return {
    x: Math.min(Math.max(position.x, area.x), area.x + Math.max(0, area.width - width)),
    y: Math.min(Math.max(position.y, area.y), area.y + Math.max(0, area.height - height)),
  }
}

// ── Window lifecycle ────────────────────────────────────────────────
export function getPetWindow() {
  return petWindow && !petWindow.isDestroyed() ? petWindow : null
}

export function syncPetWindow() {
  const config = getPetConfig()
  if (config.enabled) openPetWindow(config.character)
  else closePetWindow()
}

export function openPetWindow(character: string) {
  const existing = getPetWindow()
  if (existing) {
    existing.show()
    return existing
  }

  const manifest = readPetManifest(character)
  const width = (manifest?.frame?.width ?? DEFAULT_FRAME_WIDTH) + WINDOW_PADDING * 2
  const height = (manifest?.frame?.height ?? DEFAULT_FRAME_HEIGHT) + WINDOW_PADDING * 2
  // Mirror into the module-level size the resize guard and the renderer-driven
  // resize both read, so they stay in sync with the manifest-derived size.
  petWidth = width
  petHeight = height
  const savedPosition = readPetPosition() ?? defaultPetPosition(width, height)
  const position = clampPetPosition(savedPosition, width, height)
  // Display layout may have changed since the position was saved; persist the
  // clamped coordinates so the next launch starts from a valid spot.
  if (position.x !== savedPosition.x || position.y !== savedPosition.y) {
    getStore().set(PET_POSITION_KEY, position)
  }

  const win = new BrowserWindow({
    width,
    height,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    transparent: true,
    // Fully transparent backing; without an explicit alpha color Windows can
    // render an opaque sheet behind a transparent frameless window.
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // A pet should never steal keyboard focus from the user's active app.
    focusable: false,
    roundedCorners: false,
    // Never inherit the app's acrylic/mica material — it would render an
    // opaque blurred sheet behind the sprite instead of the desktop.
    backgroundMaterial: "none",
    title: "NekoCode Pet",
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Keep the global theme/material sync (which loops every BrowserWindow) from
  // re-applying an opaque background color or acrylic to this overlay.
  exemptFromBackgroundSync(win)

  win.setAlwaysOnTop(true, "floating")
  if (process.platform === "darwin") {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  // Hard-lock the window at its fixed content size. The pet walks by moving
  // the whole window (see petSetPosition), never by resizing it. Pinning the
  // min/max size is a best-effort guard, but on some platforms a
  // `resizable: false` window ignores min/max entirely, and a stray
  // setSize/setBounds (e.g. an older build whose walk loop resized the window
  // to follow the walk range) can still balloon it. So we pin the size AND
  // enforce it reactively below.
  win.setMinimumSize(width, height)
  win.setMaximumSize(width, height)
  win.setSize(width, height, false)

  // Bulletproof guard: if anything ever resizes this overlay — an OS DPI
  // change, a stray setBounds, or a stale build's walk logic — snap it back
  // to the fixed content size. Moving the window (the normal way the pet
  // walks) only fires `move`, not `resize`, so this never interferes with
  // walking.
  //
  // CRITICAL — the snap must tolerate ±2px. On Windows with fractional DPI
  // scaling (125%/150%), the OS itself adjusts the real window bounds by a
  // pixel or two around the requested DIP size. A zero-tolerance guard turns
  // that into an infinite resize <-> setBounds feedback loop (observed in the
  // wild: hundreds of resize events per second). Besides burning CPU, every
  // resize reaches the renderer, where the canvas backing store is reset —
  // i.e. CLEARED — so the transparent window presents an empty frame and the
  // pet visibly vanishes for a beat. The guard exists to catch *ballooning*
  // (an older build resizing the window to follow the walk range), not the
  // OS's own sub-pixel rounding, so small deviations are left alone.
  let snapTimer: NodeJS.Timeout | undefined
  win.on("resize", () => {
    if (win.isDestroyed()) return
    const b = win.getBounds()
    if (Math.abs(b.width - petWidth) <= 2 && Math.abs(b.height - petHeight) <= 2) return
    if (snapTimer) return
    snapTimer = setTimeout(() => {
      snapTimer = undefined
      if (win.isDestroyed()) return
      const again = win.getBounds()
      if (Math.abs(again.width - petWidth) <= 2 && Math.abs(again.height - petHeight) <= 2) return
      writeLog(
        "pet",
        "pet window resize intercepted, snapping back to fixed size",
        { from: { w: again.width, h: again.height }, to: { w: petWidth, h: petHeight } },
        "warn",
      )
      const [x, y] = win.getPosition()
      win.setBounds({ x, y, width: petWidth, height: petHeight })
    }, 100)
  })

  petWindow = win
  loadWindow(win, `pet.html?character=${encodeURIComponent(character)}`)

  // Surface silent transparent-window load failures instead of showing a
  // blank spot over the desktop with no diagnostics.
  win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    writeLog("pet", "page load failed", { errorCode, errorDescription, url: validatedURL }, "error")
  })
  win.webContents.on("preload-error", (_e, preloadPath, error) => {
    writeLog("pet", "preload error", { preloadPath, error }, "error")
  })
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) writeLog("pet", "renderer console", { level, message, line, sourceId }, "error")
  })

  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return
    // Re-pin the size and clamped position once the window is measurable.
    // Transparent frameless windows can come up with a stray boundary on
    // Windows if shown before layout settles.
    const next = clampPetPosition(position, width, height)
    win.setBounds({ ...next, width, height })
    win.showInactive()
  })
  win.on("move", schedulePersistPosition)
  win.on("close", persistPetPosition)
  win.on("closed", () => {
    if (snapTimer) clearTimeout(snapTimer)
    snapTimer = undefined
    if (petWindow === win) petWindow = null
    dragOffset = null
  })

  return win
}

export function closePetWindow() {
  const win = getPetWindow()
  if (!win) return
  win.destroy()
  petWindow = null
  dragOffset = null
}

export function destroyPetWindow() {
  closePetWindow()
}

// ── Dragging ────────────────────────────────────────────────────────
export function petDragStart() {
  const win = getPetWindow()
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const [x, y] = win.getPosition()
  dragOffset = { x: cursor.x - x, y: cursor.y - y }
}

export function petDragMove(screenX: number, screenY: number) {
  const win = getPetWindow()
  if (!win || !dragOffset) return
  win.setPosition(Math.round(screenX - dragOffset.x), Math.round(screenY - dragOffset.y))
}

export function petDragEnd() {
  dragOffset = null
  persistPetPosition()
}

// ── Walking / positioning ───────────────────────────────────────────
export function petGetPosition(): [number, number] | null {
  const win = getPetWindow()
  if (!win) return null
  const [x, y] = win.getPosition()
  return [x, y]
}

export function petSetPosition(x: number, y: number) {
  const win = getPetWindow()
  if (!win) return
  win.setPosition(Math.round(x), Math.round(y))
  schedulePersistPosition()
}

export function petGetWorkArea(): PetWorkArea {
  const win = getPetWindow()
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
  const area = display.workArea
  return { x: area.x, y: area.y, width: area.width, height: area.height }
}

// Forwards a host-app context event (think/run/success/error/review/idle) to
// the pet renderer, which maps it to the matching spritesheet row (4-8).
export function notifyPet(event: PetEvent) {
  const win = getPetWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send("pet-event", event)
}

// Resizes the pet overlay to fit a non-standard spritesheet cell, as detected
// by the renderer. The renderer auto-detects the grid from the image's alpha
// gutters; when the detected cell size differs from the Codex default, it asks
// the main process to grow/shrink the transparent window so the sprite is not
// clipped. The position is kept centered on its previous spot so the pet does
// not jump, and the module-level size is updated in lock-step so the resize
// guard (which tolerates ±2px for fractional-DPI rounding) does not snap it
// back. Min/max are updated too, since resizable:false windows clamp to them.
export function petSetContentSize(frameWidth: number, frameHeight: number) {
  const win = getPetWindow()
  if (!win || win.isDestroyed()) return
  const nextWidth = Math.round(frameWidth) + WINDOW_PADDING * 2
  const nextHeight = Math.round(frameHeight) + WINDOW_PADDING * 2
  if (nextWidth <= 0 || nextHeight <= 0) return
  const [x, y] = win.getPosition()
  const [curW, curH] = win.getSize()
  // Anchor by the window center so the sprite stays put visually.
  const anchorX = x + (curW - nextWidth) / 2
  const anchorY = y + (curH - nextHeight) / 2
  petWidth = nextWidth
  petHeight = nextHeight
  const next = clampPetPosition({ x: anchorX, y: anchorY }, petWidth, petHeight)
  win.setMinimumSize(petWidth, petHeight)
  win.setMaximumSize(petWidth, petHeight)
  win.setBounds({ x: next.x, y: next.y, width: petWidth, height: petHeight })
}

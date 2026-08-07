import windowState from "electron-window-state"
import { resolveThemeVariant } from "@opencode-ai/ui/theme/resolve"
import type { DesktopTheme } from "@opencode-ai/ui/theme/types"
import type { WindowMaterial } from "@opencode-ai/app"
import oc2ThemeJson from "../../../ui/src/theme/themes/oc-2.json"
import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { app, BrowserWindow, dialog, net, nativeImage, nativeTheme, protocol, shell } from "electron"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { TitlebarTheme } from "../preload/types"
import { exportDebugLogs, write as writeLog } from "./logging"
import { getStore, removeStoreFile } from "./store"
import { PINCH_ZOOM_ENABLED_KEY, WINDOW_IDS_KEY, WINDOW_MATERIAL_KEY } from "./store-keys"
import { createUnresponsiveSampler } from "./unresponsive"
import { nativeT } from "./native-translations"
import { createWindowRegistry } from "./window-registry"
import { safeWindowURL } from "./window-state"
import { resolveExternalURL, resolveLocalFilePath } from "./external-url"

const root = dirname(fileURLToPath(import.meta.url))
const rendererRoot = join(root, "../renderer")
const rendererProtocol = "oc"
const rendererHost = "renderer"
const clipboardWritePermission = "clipboard-sanitized-write"
const notificationPermission = "notifications"
const rendererPermissions = new Set([clipboardWritePermission, notificationPermission])
const oc2Theme = oc2ThemeJson as DesktopTheme
const oc2Background = {
  light: resolveThemeVariant(oc2Theme.light, false)["background-base"],
  dark: resolveThemeVariant(oc2Theme.dark, true)["background-base"],
}
const documentPolicyHeader = "Document-Policy"
const jsCallStacksDocumentPolicy = "include-js-call-stacks-in-crash-reports"

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererProtocol,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    // Serves bundled desktop-pet assets (spritesheets, manifests) to the pet window.
    scheme: "oc-pet",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      // The pet window origin (localhost in dev, oc://renderer packaged) is
      // always cross-origin relative to this scheme.
      corsEnabled: true,
    },
  },
])

let backgroundColor: string | undefined
let windowMaterial: WindowMaterial = "acrylic"
// 重启/新建窗口时读取主进程持久化的材质选择（渲染进程 localhost 为权威值，
// 挂载后会用 IPC 再同步一次，两者默认一致 "acrylic"）。
function readWindowMaterial(): WindowMaterial {
  const value = getStore().get(WINDOW_MATERIAL_KEY)
  return value === "default" || value === "mica" || value === "acrylic" ? value : "acrylic"
}

// ── Win11 云母（Mica）─────────────────────────────────────────────
// Electron 自带 backgroundMaterial:"mica" 的 DWM 实现不完整，出不来真正的云母。
// 这里复刻 window-vibrancy::apply_mica：直接调 DwmSetWindowAttribute 设置
//   DWMWA_USE_IMMERSIVE_DARK_MODE(20) 和 DWMWA_SYSTEMBACKDROP_TYPE(38)。
// 用 DWMSBT_TABBEDWINDOW(4)=Mica Alt 而非普通 Mica（DWMSBT_MAINWINDOW=2）：
// Mica Alt 的背板色调明显更强，接近 Windows 资源管理器的可见度。
// 若个别机器觉得过艳，可改回 DWMSBT_MAINWINDOW。
// FFI 用项目已有的 koffi（惰性加载；koffi 不可用时此函数为 no-op，不影响亚克力）。
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20
const DWMWA_SYSTEMBACKDROP_TYPE = 38
const DWMSBT_TABBEDWINDOW = 4

let koffiLib: Promise<any | null> | undefined
function loadKoffi() {
  if (!koffiLib) {
    koffiLib = import("koffi")
      .then((m) => (m as any).default ?? (m as any))
      .catch(() => null)
  }
  return koffiLib
}

let dwmSetWindowAttribute: ((hwnd: bigint, attr: number, value: Buffer, cb: number) => number) | undefined

async function dwmBackdrop(win: BrowserWindow, attr: number, value: number) {
  if (process.platform !== "win32") return
  const koffi = await loadKoffi()
  if (!koffi) return
  try {
    let setAttr = dwmSetWindowAttribute
    if (!setAttr) {
      const dwmapi = koffi.load("dwmapi.dll")
      setAttr = dwmapi.func(
        "long DwmSetWindowAttribute(uint64 hwnd, uint32 dwAttribute, const void *pvAttribute, uint32 cbAttribute)",
      )
      dwmSetWindowAttribute = setAttr
    }
    const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0)
    const buf = Buffer.alloc(4)
    buf.writeUInt32LE(value, 0)
    setAttr!(hwnd, attr, buf, 4)
  } catch (error) {
    writeLog(
      "window",
      "DwmSetWindowAttribute failed",
      { error: error instanceof Error ? error.message : String(error) },
      "warn",
    )
  }
}

function applyMica(win: BrowserWindow) {
  return Promise.all([
    dwmBackdrop(win, DWMWA_USE_IMMERSIVE_DARK_MODE, tone() === "dark" ? 1 : 0),
    dwmBackdrop(win, DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_TABBEDWINDOW),
  ])
}

let relaunchHandler = () => {
  setAppQuitting()
  app.relaunch()
  app.exit(0)
}
const titlebarThemes = new WeakMap<BrowserWindow, Partial<TitlebarTheme>>()
const pinchZoomEnabled = new WeakMap<BrowserWindow, boolean>()
const windowIDs = new WeakMap<BrowserWindow, string>()
const registry = createWindowRegistry<BrowserWindow>({
  read: () => getStore().get(WINDOW_IDS_KEY),
  write: (ids) => getStore().set(WINDOW_IDS_KEY, ids),
  cleanup: (id) => {
    rmSync(join(app.getPath("userData"), windowStateFile(id)), { force: true })
    removeStoreFile(windowDataFile(id))
  },
})
const maxZoomLevel = 10
const minZoomLevel = 0.2

export function setRelaunchHandler(handler: () => void) {
  relaunchHandler = handler
}

export function setAppQuitting(quitting = true) {
  registry.setQuitting(quitting)
}

// Windows excluded from the global background color / material sync, e.g. the
// transparent pet overlay — applying an acrylic material or opaque background
// color to it would destroy its transparency.
const backgroundSyncExempt = new WeakSet<BrowserWindow>()

export function exemptFromBackgroundSync(win: BrowserWindow) {
  backgroundSyncExempt.add(win)
}

function backgroundSyncTargets() {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && !backgroundSyncExempt.has(win))
}

export function setBackgroundColor(color: string) {
  backgroundColor = color
  backgroundSyncTargets().forEach((win) => {
    // Windows + 亚克力/云母：材质需要透明背景，跳过不透明背景色设置；
    // Windows + 默认材质：与其余平台一样应用不透明背景色。
    const apply = process.platform !== "win32" || windowMaterial === "default"
    if (apply) win.setBackgroundColor(color)
    if (process.platform === "darwin") win.invalidateShadow()
  })
}

export function getBackgroundColor(): string | undefined {
  return backgroundColor
}

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function iconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  return join(iconsDir(), `icon.${ext}`)
}

function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light"
}

function defaultBackgroundColor() {
  return oc2Background[tone()]
}

export function setTitlebar(win: BrowserWindow, theme: Partial<TitlebarTheme> = {}) {
  titlebarThemes.set(win, theme)
  // macOS draws the window frame hairline and shadow using the NSWindow
  // appearance, which follows nativeTheme rather than the rendered content.
  // Align it with the app theme so a light app on a dark system does not get
  // the dark-appearance border and shadow. A "system" scheme must map to
  // "system" (not the resolved mode) or prefers-color-scheme stops tracking
  // OS appearance changes in the renderer.
  if (process.platform === "darwin") nativeTheme.themeSource = theme.scheme ?? theme.mode ?? "system"
}

/**
 * No-op. Window Controls Overlay (WCO) is disabled — the renderer draws its
 * own window controls in the title bar (`WindowControls`). Kept exported so
 * callers (zoom/theme updates) keep resolving.
 */
export function updateTitlebar(_win: BrowserWindow) {}

export function setPinchZoomEnabled(enabled: boolean) {
  getStore().set(PINCH_ZOOM_ENABLED_KEY, enabled)
  for (const win of backgroundSyncTargets()) {
    pinchZoomEnabled.set(win, enabled)
    win.webContents.send("pinch-zoom-enabled-changed", enabled)
    if (!enabled && win.webContents.getZoomFactor() !== 1) win.webContents.setZoomFactor(1)
    updateZoom(win)
  }
}

export function getPinchZoomEnabled() {
  return getStore().get(PINCH_ZOOM_ENABLED_KEY) === true
}

export function setWindowMaterial(material: WindowMaterial) {
  windowMaterial = material
  getStore().set(WINDOW_MATERIAL_KEY, material)
  backgroundSyncTargets().forEach((win) => {
    if (process.platform !== "win32") return
    if (material === "default") {
      win.setBackgroundMaterial("none")
      win.setBackgroundColor(backgroundColor ?? defaultBackgroundColor())
    } else if (material === "mica") {
      // 云母：透明背景让 DWM 背板采样壁纸色调透出（applyMica 走 DwmSetWindowAttribute）。
      win.setBackgroundMaterial("none")
      win.setBackgroundColor("#00000000")
      void applyMica(win)
    } else {
      // 亚克力：透明背景，让模糊采样透出。
      win.setBackgroundMaterial("acrylic")
      win.setBackgroundColor("#00000000")
    }
  })
}

export function getWindowID(win: BrowserWindow) {
  return windowIDs.get(win)
}

export function getLastFocusedWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) return focused
  const win = registry.lastFocused()
  if (!win || win.isDestroyed()) return null
  return win
}

export function restoreMainWindows() {
  const ids = registry.persisted()
  return (ids.length ? ids : [randomUUID()]).map((id) => createMainWindow(id))
}

export function setDockIcon() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"))
  if (!icon.isEmpty()) app.dock?.setIcon(icon)
}

export function createMainWindow(id: string = randomUUID()) {
  const state = windowState({
    file: windowStateFile(id),
    defaultWidth: 1280,
    defaultHeight: 800,
  })

  // 新建/重启窗口时按持久化的窗口材质决定初始透明与亚克力。
  windowMaterial = readWindowMaterial()

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    autoHideMenuBar: true,
    title: "NekoCode",
    icon: iconPath(),
    // Windows 11: 亚克力材质需要透明背景（在下方 win32 分支用 #00000000）；
    // 其他平台保持不透明背景色。
    ...(process.platform === "win32" ? {} : { backgroundColor: backgroundColor ?? defaultBackgroundColor() }),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
      : {}),
    ...(process.platform === "win32"
      ? windowMaterial === "default"
        ? {
            // 默认材质（无材质）：普通不透明窗口，无 backgroundMaterial。
            titleBarStyle: "hidden" as const,
            backgroundColor: backgroundColor ?? defaultBackgroundColor(),
          }
        : windowMaterial === "mica"
          ? {
              // Win11 云母：透明背景，让 DWM 背板采样壁纸色调透出；
              // 真正材质由 ready-to-show 里的 applyMica（DwmSetWindowAttribute）应用。
              titleBarStyle: "hidden" as const,
              backgroundColor: "#00000000",
              backgroundMaterial: "none",
            }
          : {
              // No `titleBarOverlay` here: the renderer draws its own window
              // controls in the title bar (see `WindowControls`).
              // 只用 titleBarStyle: "hidden" 隐藏标题栏并保住 DWM 非客户区
              // （系统圆角 + 边框 + 阴影 + 材质）。不用 frame: false，否则
              // Windows 上会压过 titleBarStyle 做成完全无边框窗口，丢失圆角。
              titleBarStyle: "hidden" as const,
              // 透明背景色让 Chromium webview 透明渲染，否则 webview 默认的
              // 不透明背景会遮挡 backgroundMaterial 的材质（亚克力）。
              // 不用 transparent: true，避免触发 layered window 而禁用 DWM 系统圆角。
              backgroundColor: "#00000000",
              backgroundMaterial: "acrylic",
            }
      : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  allowRendererPermissions(win)
  wireWindowRecovery(win, id)
  wireNavigationPolicy(win)

  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details
    upsertKeyValue(requestHeaders, "Access-Control-Allow-Origin", ["*"])
    callback({ requestHeaders })
  })

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders = {} } = details
    addRendererHeaders(details.url, responseHeaders)
    callback({ responseHeaders })
  })

  state.manage(win)
  registerWindow(win, id)
  wireFullscreen(win)
  wireWindowMaximize(win)
  loadWindow(win, "index.html")
  wireZoom(win)

  win.once("ready-to-show", () => {
    // 显式应用材质：云母走 DWM（applyMica），亚克力走 Electron，确保构造选项生效。
    if (process.platform === "win32") {
      if (windowMaterial === "mica") void applyMica(win)
      else if (windowMaterial === "acrylic") win.setBackgroundMaterial("acrylic")
    }
    win.show()
  })

  return win
}

export function openExternalURL(value: string) {
  const url = resolveExternalURL(value)
  if (!url) {
    writeLog("window", "blocked external target", { url: value }, "warn")
    return
  }
  void shell.openExternal(url)
}

export function openLocalFileURL(value: string) {
  const path = resolveLocalFilePath(value)
  if (!path) {
    writeLog("window", "blocked local file target", { url: value }, "warn")
    return
  }
  void shell.openPath(path).then((error) => {
    if (error) writeLog("window", "failed to open local file", { path, error }, "error")
  })
}

function wireNavigationPolicy(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isRendererUrl(url)) openExternalURL(url)
    return { action: "deny" }
  })
  // Renderer reloads (window.location.reload) navigate to the app's own URL
  // and must stay in-window; everything else leaves through the OS.
  win.webContents.on("will-navigate", (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    openExternalURL(url)
  })
}

function registerWindow(win: BrowserWindow, id: string) {
  windowIDs.set(win, id)
  registry.register(id, win)

  win.on("focus", () => registry.focused(id))
  // Windows never emits before-quit on OS shutdown/logoff, but each window
  // gets session-end before it closes; flag the quit so ids stay persisted.
  win.on("session-end", () => registry.setQuitting())
  win.on("closed", () => registry.closed(id))
}

function windowStateFile(id: string) {
  return `window-state-${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

// Mirrors windowStorage() in packages/app/src/utils/persist.ts, which names
// the per-window renderer store this window persists its tabs into.
function windowDataFile(id: string) {
  return `opencode.window.${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.dat`
}

export function registerRendererProtocol() {
  if (protocol.isProtocolHandled(rendererProtocol)) return

  protocol.handle(rendererProtocol, async (request) => {
    const url = new URL(request.url)
    if (url.host !== rendererHost) {
      writeLog("protocol", "rejected host", { url: request.url }, "warn")
      return new Response("Not found", { status: 404 })
    }

    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`)
    const rel = relative(rendererRoot, file)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      writeLog("protocol", "rejected path", { url: request.url, file }, "warn")
      return new Response("Not found", { status: 404 })
    }

    try {
      const range = request.headers.get("range")
      const response = await net.fetch(pathToFileURL(file).toString(), {
        headers: range ? { range } : undefined,
      })
      if (response.status >= 400) {
        writeLog(
          "protocol",
          "fetch failed",
          {
            url: request.url,
            file,
            status: response.status,
            statusText: response.statusText,
          },
          "error",
        )
      }
      return addDocumentPolicy(response, file)
    } catch (error) {
      writeLog("protocol", "fetch error", { url: request.url, file, error }, "error")
      return new Response("Not found", { status: 404 })
    }
  })
}

export function loadWindow(win: BrowserWindow, html: string) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(html, devUrl)
    void win.loadURL(url.toString())
    return
  }

  void win.loadURL(`${rendererProtocol}://${rendererHost}/${html}`)
}

function wireWindowRecovery(win: BrowserWindow, name: string) {
  let showing = false
  const sampler = createUnresponsiveSampler(win, name)

  type RecoveryAction = "relaunch" | "export-logs" | "keep-waiting" | "quit"
  const handle = async (action: RecoveryAction | undefined, wait: boolean) => {
    if (action === "export-logs") {
      const sampling = sampler.stopAndFlush()
      await exportDebugLogs().catch((error) => writeLog("main", "failed to export debug logs", { error }, "error"))
      if (wait && sampling) sampler.start()
      return true
    }
    if (action === "relaunch") {
      sampler.stopAndFlush()
      relaunchHandler()
      return false
    }
    if (action === "quit") {
      sampler.stopAndFlush()
      app.quit()
    }
    return false
  }

  const show = async (message: string, detail: string, wait: boolean) => {
    if (showing || win.isDestroyed()) return
    showing = true
    try {
      while (!win.isDestroyed()) {
        const actions: { id: RecoveryAction; label: string }[] = wait
          ? [
              { id: "relaunch", label: nativeT("desktop.recovery.action.relaunch") },
              { id: "export-logs", label: nativeT("desktop.recovery.action.exportLogs") },
              { id: "keep-waiting", label: nativeT("desktop.recovery.action.keepWaiting") },
            ]
          : [
              { id: "relaunch", label: nativeT("desktop.recovery.action.relaunch") },
              { id: "export-logs", label: nativeT("desktop.recovery.action.exportLogs") },
              { id: "quit", label: nativeT("desktop.recovery.action.quit") },
            ]
        const result = await dialog.showMessageBox(win, {
          type: "warning",
          buttons: actions.map((action) => action.label),
          defaultId: 0,
          cancelId: 2,
          message,
          detail,
        })
        if (await handle(actions[result.response]?.id, wait)) continue
        return
      }
    } finally {
      showing = false
    }
  }

  const failed = (
    event: string,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ) => {
    writeLog(
      "window",
      "renderer load failed",
      {
        window: name,
        event,
        errorCode,
        errorDescription,
        validatedURL,
        currentURL: safeWindowURL(win),
        isMainFrame,
      },
      "error",
    )

    if (!isMainFrame || errorCode === -3) return
    void show(
      nativeT("desktop.recovery.loadFailed"),
      nativeT("desktop.recovery.loadFailed.detail", {
        window: name,
        url: validatedURL,
        code: errorCode,
        description: errorDescription,
      }),
      false,
    )
  }

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    failed("did-fail-load", errorCode, errorDescription, validatedURL, isMainFrame)
  })
  win.webContents.on("did-fail-provisional-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    failed("did-fail-provisional-load", errorCode, errorDescription, validatedURL, isMainFrame)
  })
  win.webContents.on("render-process-gone", (_event, details) => {
    sampler.stopAndFlush()
    writeLog("window", "renderer process gone", { window: name, currentURL: safeWindowURL(win), details }, "error")
    void show(
      nativeT("desktop.recovery.terminated"),
      nativeT("desktop.recovery.terminated.detail", {
        window: name,
        reason: details.reason,
        code: details.exitCode ?? nativeT("desktop.recovery.unknown"),
      }),
      false,
    )
  })
  win.on("unresponsive", () => {
    writeLog("window", "renderer unresponsive", { window: name, currentURL: safeWindowURL(win) }, "error")
    sampler.start()
    void show(nativeT("desktop.recovery.unresponsive"), nativeT("desktop.recovery.unresponsive.detail"), true)
  })
  win.on("responsive", () => {
    writeLog("window", "renderer responsive", { window: name, currentURL: safeWindowURL(win) }, "error")
    sampler.stopAndFlush()
  })
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (message.toLowerCase().includes("terminal") || sourceId.toLowerCase().includes("terminal")) {
      writeLog("pty", "console", { window: name, level, message, line, sourceId })
    }
  })
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    writeLog("preload", "preload error", { window: name, preloadPath, error }, "error")
  })
}

function addDocumentPolicy(response: Response, file: string) {
  if (!file.toLowerCase().endsWith(".html")) return response
  const headers = new Headers(response.headers)
  headers.set(documentPolicyHeader, jsCallStacksDocumentPolicy)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function allowRendererPermissions(win: BrowserWindow) {
  const webContentsId = win.webContents.id

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      rendererPermissions.has(permission) &&
        isTrustedRendererUrl(details.requestingUrl) &&
        webContents.id === webContentsId,
    )
  })
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!rendererPermissions.has(permission)) return false
    if (webContents && webContents.id !== webContentsId) return false
    return isTrustedRendererUrl(details.requestingUrl) || isTrustedRendererUrl(requestingOrigin)
  })
}

function isTrustedRendererUrl(value?: string) {
  return isRendererUrl(value)
}

function addRendererHeaders(value: string, headers: Record<string, any>) {
  upsertKeyValue(headers, "Access-Control-Allow-Origin", ["*"])
  upsertKeyValue(headers, "Access-Control-Allow-Headers", ["*"])
  if (isRendererUrl(value, true)) upsertKeyValue(headers, documentPolicyHeader, [jsCallStacksDocumentPolicy])
}

function isRendererUrl(value?: string, html = false) {
  if (!value || !URL.canParse(value)) return false
  const url = new URL(value)
  if (html && !url.pathname.endsWith(".html")) return false
  if (url.protocol === `${rendererProtocol}:` && url.host === rendererHost) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!devUrl || !URL.canParse(devUrl)) return false
  return url.origin === new URL(devUrl).origin
}

function wireZoom(win: BrowserWindow) {
  pinchZoomEnabled.set(win, getPinchZoomEnabled())
  win.webContents.setZoomFactor(1)
  win.webContents.on("zoom-changed", (event, zoomDirection) => {
    event.preventDefault()
    if (pinchZoomEnabled.get(win)) {
      win.webContents.setZoomFactor(clampZoom(win.webContents.getZoomFactor() + (zoomDirection === "in" ? 0.2 : -0.2)))
      updateZoom(win)
      return
    }
    if (win.webContents.getZoomFactor() !== 1) win.webContents.setZoomFactor(1)
    updateZoom(win)
  })
}

function wireFullscreen(win: BrowserWindow) {
  const send = (fullscreen: boolean) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send("window-fullscreen-changed", fullscreen)
  }

  win.on("enter-full-screen", () => send(true))
  win.on("leave-full-screen", () => send(false))
}

function wireWindowMaximize(win: BrowserWindow) {
  const send = (maximized: boolean) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send("window-maximized-changed", maximized)
  }

  win.on("maximize", () => send(true))
  win.on("unmaximize", () => send(false))
}

function clampZoom(value: number) {
  return Math.min(Math.max(value, minZoomLevel), maxZoomLevel)
}

function updateZoom(win: BrowserWindow) {
  updateTitlebar(win)
  win.webContents.send("zoom-factor-changed", win.webContents.getZoomFactor())
}

function upsertKeyValue(obj: Record<string, any>, keyToChange: string, value: any) {
  const keyToChangeLower = keyToChange.toLowerCase()
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToChangeLower) {
      // Reassign old key
      obj[key] = value
      // Done
      return
    }
  }
  // Insert at end instead
  obj[keyToChange] = value
}

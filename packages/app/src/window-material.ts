/**
 * 桌面窗口背景材质选择(仅 Windows 有意义)。
 *
 * 渲染进程持有权威值(本地存储 `opencode-window-material`),并把它应用到:
 *  1. `document.documentElement.dataset.windowMaterial` —— 驱动 index.css 里
 *     html 背景是否透明(亚克力/云母透出)的切换;
 *  2. 通过 platform.setWindowMaterial() 的 IPC 通知主进程切换窗口
 *     `backgroundMaterial` 与背景色。
 *
 * - "acrylic": 亚克力材质(透明背景 + 亚克力)
 * - "mica":    Win11 云母材质(透明背景 + 云母)
 * - "default": 无材质,普通不透明窗口
 */
export type WindowMaterial = "acrylic" | "mica" | "default"

export const WINDOW_MATERIAL_KEY = "opencode-window-material"

export const DEFAULT_WINDOW_MATERIAL: WindowMaterial = "acrylic"

export function readWindowMaterial(): WindowMaterial {
  if (typeof localStorage !== "object") return DEFAULT_WINDOW_MATERIAL
  try {
    const value = localStorage.getItem(WINDOW_MATERIAL_KEY)
    return value === "default" || value === "mica" || value === "acrylic" ? value : DEFAULT_WINDOW_MATERIAL
  } catch {
    return DEFAULT_WINDOW_MATERIAL
  }
}

export function writeWindowMaterial(material: WindowMaterial) {
  if (typeof localStorage !== "object") return
  try {
    localStorage.setItem(WINDOW_MATERIAL_KEY, material)
  } catch {}
}

/**
 * 在 <html> 上设置 `data-window-material` 为实际材质值（mica | acrylic | default）。
 * index.css 据此切换 html 背景透明度与面板遮罩强度：
 * - "default"：html 改回不透明主题背景（bg-deep），遮住原生材质，呈现普通不透明窗口；
 * - "mica"：html 保持透明，并启用云母专属的更低面板遮罩（.window-pane）；
 * - "acrylic"：html 保持透明，使用默认面板遮罩。
 */
export function applyWindowMaterialAttribute(material: WindowMaterial) {
  if (typeof document !== "object") return
  document.documentElement.setAttribute("data-window-material", material)
}

;(function () {
  var key = "opencode-theme-id"
  var themeId = localStorage.getItem(key) || "oc-2"

  if (themeId === "oc-1") {
    themeId = "oc-2"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("opencode-theme-css-light")
    localStorage.removeItem("opencode-theme-css-dark")
  }

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  // 提前把窗口材质属性设为实际值（mica | acrylic | default），避免首屏闪变：
  // index.css 据此决定 html 是否透明 / 云母面板遮罩强度。
  //  - default：html 不透明，遮住原生材质；
  //  - mica/acrylic：html 透明，透出原生材质。
  var material = localStorage.getItem("opencode-window-material")
  if (material === "mica" || material === "acrylic" || material === "default") {
    document.documentElement.setAttribute("data-window-material", material)
  }
  // Electron + Windows 11 使用原生亚克力材质，需要透明背景，跳过不透明背景色设置；
  // 其他环境保持不透明背景色以防主题加载前的白闪。
  var isElectronWindows = /Electron/.test(navigator.userAgent) && /Windows/.test(navigator.userAgent)
  if (!isElectronWindows) {
    document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa"
  }

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#080808" : "#fafafa")

  if (themeId === "oc-2") return

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()

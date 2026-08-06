import { Component, Show, createSignal } from "solid-js"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import {
  applyWindowMaterialAttribute,
  readWindowMaterial,
  writeWindowMaterial,
  type WindowMaterial,
} from "@/window-material"
import { ExternalLink } from "../external-link"
import { createAppearanceSettingsController, type AppearanceSettingsController } from "./general-controllers"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

const schemeOptions: ("system" | "light" | "dark")[] = ["system", "light", "dark"]
const materialOptions: WindowMaterial[] = ["acrylic", "mica", "default"]

const fontSettings = {
  ui: {
    action: "settings-ui-font",
    title: "settings.general.row.uiFont.title",
    description: "settings.general.row.uiFont.description",
    font: "ui",
    input: "setUI",
  },
  code: {
    action: "settings-code-font",
    title: "settings.general.row.font.title",
    description: "settings.general.row.font.description",
    font: "code",
    input: "setCode",
  },
  terminal: {
    action: "settings-terminal-font",
    title: "settings.general.row.terminalFont.title",
    description: "settings.general.row.terminalFont.description",
    font: "terminal",
    input: "setTerminal",
  },
} as const

const FontSetting: Component<{
  kind: "ui" | "code" | "terminal"
  fonts: AppearanceSettingsController["fonts"]
}> = (props) => {
  const language = useLanguage()
  const config = () => fontSettings[props.kind]
  return (
    <SettingsRowV2 title={language.t(config().title)} description={language.t(config().description)}>
      <div class="w-full sm:w-[220px]">
        <TextInputV2
          data-action={config().action}
          type="text"
          appearance="base"
          value={props.fonts[config().font]().value}
          onInput={(event) => props.fonts[config().input](event.currentTarget.value)}
          placeholder={props.fonts[config().font]().placeholder}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          aria-label={language.t(config().title)}
          style={{ "font-family": props.fonts[config().font]().family }}
        />
      </div>
    </SettingsRowV2>
  )
}

/** 设置页「外观」标签页：配色方案 + 主题 + 字体 + 窗口材质（仅 Windows）。 */
export const SettingsAppearanceV2: Component = () => {
  const language = useLanguage()
  const appearance = createAppearanceSettingsController()
  const platform = usePlatform()

  // 仅 Windows 桌面支持窗口背景材质切换。
  const isWindows = () => platform.platform === "desktop" && platform.os === "windows"

  const [material, setMaterial] = createSignal<WindowMaterial>(readWindowMaterial())

  const selectMaterial = (option: WindowMaterial | null) => {
    if (!option || option === material()) return
    setMaterial(option)
    writeWindowMaterial(option)
    applyWindowMaterialAttribute(option)
    void platform.setWindowMaterial?.(option)
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.appearance")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.general.row.colorScheme.title")}
              description={language.t("settings.general.row.colorScheme.description")}
            >
              <SelectV2
                appearance="inline"
                data-action="settings-color-scheme"
                options={schemeOptions}
                current={schemeOptions.find((option) => option === appearance.scheme.current())}
                placement="bottom-end"
                gutter={6}
                label={(option) => {
                  if (option === "system") return language.t("theme.scheme.system")
                  if (option === "light") return language.t("theme.scheme.light")
                  return language.t("theme.scheme.dark")
                }}
                onSelect={(option) => option && appearance.scheme.select(option)}
              />
            </SettingsRowV2>

            <SettingsRowV2
              title={language.t("settings.general.row.theme.title")}
              description={
                <>
                  {language.t("settings.general.row.theme.description")}{" "}
                  <ExternalLink class="settings-v2-link" href="https://opencode.ai/docs/themes/">
                    {language.t("common.learnMore")}
                  </ExternalLink>
                </>
              }
            >
              <SelectV2
                appearance="inline"
                data-action="settings-theme"
                options={appearance.theme.options()}
                current={appearance.theme.current()}
                placement="bottom-end"
                gutter={6}
                value={(option) => option.id}
                label={(option) => option.name}
                onSelect={appearance.theme.select}
              />
            </SettingsRowV2>

            <FontSetting kind="ui" fonts={appearance.fonts} />
            <FontSetting kind="code" fonts={appearance.fonts} />
            <FontSetting kind="terminal" fonts={appearance.fonts} />

            <Show when={isWindows()}>
              <SettingsRowV2
                title={language.t("settings.appearance.row.windowMaterial.title")}
                description={language.t("settings.appearance.row.windowMaterial.description")}
              >
                <SelectV2
                  appearance="inline"
                  data-action="settings-window-material"
                  options={materialOptions}
                  current={material()}
                  placement="bottom-end"
                  gutter={6}
                  label={(option) => {
                    if (option === "mica") return language.t("settings.windowMaterial.mica")
                    if (option === "default") return language.t("settings.windowMaterial.default")
                    return language.t("settings.windowMaterial.acrylic")
                  }}
                  onSelect={selectMaterial}
                />
              </SettingsRowV2>
            </Show>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}

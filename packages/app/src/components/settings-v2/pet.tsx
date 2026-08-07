import { Component, Show, createEffect, createResource, createSignal } from "solid-js"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { PetCharacterInfo } from "@/pet"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

/** Settings tab controlling the desktop pet companion (desktop only). */
export const SettingsPetV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const pet = () => (platform.platform === "desktop" ? platform.pet : undefined)

  const [config] = createResource(async () => {
    const api = pet()
    if (!api) return null
    return api.getConfig()
  })
  const [characters] = createResource(async () => {
    const api = pet()
    if (!api) return []
    return api.list()
  })

  const [enabled, setEnabled] = createSignal(false)
  const [character, setCharacter] = createSignal("taffy")

  createEffect(() => {
    const value = config()
    if (!value) return
    setEnabled(value.enabled)
    setCharacter(value.character)
  })

  const toggleEnabled = async (value: boolean) => {
    const previous = enabled()
    setEnabled(value)
    try {
      await pet()?.setEnabled(value)
    } catch (error) {
      setEnabled(previous)
      console.error("[pet] failed to update enabled state", error)
    }
  }

  const selectCharacter = (option: PetCharacterInfo | null) => {
    if (!option || option.id === character()) return
    setCharacter(option.id)
    void pet()?.setCharacter(option.id)
  }

  const currentCharacter = () => (characters() ?? []).find((item) => item.id === character())

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.pet")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <Show when={pet()}>
          <div class="settings-v2-section">
            <SettingsListV2>
              <SettingsRowV2
                title={language.t("settings.pet.row.enabled.title")}
                description={language.t("settings.pet.row.enabled.description")}
              >
                <div data-action="settings-pet-enabled">
                  <Switch checked={enabled()} onChange={toggleEnabled} />
                </div>
              </SettingsRowV2>

              <Show when={(characters() ?? []).length > 0}>
                <SettingsRowV2
                  title={language.t("settings.pet.row.character.title")}
                  description={language.t("settings.pet.row.character.description")}
                >
                  <SelectV2
                    appearance="inline"
                    data-action="settings-pet-character"
                    options={characters() ?? []}
                    current={currentCharacter()}
                    placement="bottom-end"
                    gutter={6}
                    value={(option) => option.id}
                    label={(option) => option.displayName}
                    onSelect={selectCharacter}
                  />
                </SettingsRowV2>
              </Show>
            </SettingsListV2>
          </div>
        </Show>
      </div>
    </>
  )
}

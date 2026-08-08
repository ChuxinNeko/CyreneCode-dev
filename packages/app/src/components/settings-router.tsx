import { Component, For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSync } from "@/context/server-sync"
import { SettingsList } from "./settings-list"

type RouterMode = "observe" | "full"
type BudgetAction = "warn" | "cap"

type RouterConfigValue = {
  enabled?: boolean
  mode?: RouterMode
  tiers?: Record<string, string>
  budget?: { limitUsd?: number; action?: BudgetAction }
  depthFloor?: number
  depthCap?: number
}

const TIER_NAMES = ["S", "M", "L", "XL"] as const

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]
type ModelGroup = { providerID: string; providerName: string; items: ModelItem[] }

export const SettingsRouter: Component = () => {
  const language = useLanguage()
  const serverSync = useServerSync()

  const router = (): RouterConfigValue => serverSync().data.config.router ?? {}

  const setRouter = (patch: Partial<RouterConfigValue>) =>
    serverSync().updateConfig({ router: { ...router(), ...patch } })

  const modeOptions = () =>
    (["observe", "full"] as const).map((value) => ({
      value,
      label: language.t(
        value === "observe" ? "settings.router.mode.observe" : "settings.router.mode.full",
      ),
    }))

  const setTier = (tier: (typeof TIER_NAMES)[number], value: string) => {
    const tiers = { ...(router().tiers ?? {}) }
    if (value.trim()) tiers[tier] = value.trim()
    else delete tiers[tier]
    setRouter({ tiers })
  }

  const budget = () => router().budget ?? {}
  const setBudget = (patch: { limitUsd?: number; action?: BudgetAction }) =>
    setRouter({ budget: { ...budget(), ...patch } })

  const budgetActions = (): { value: BudgetAction; label: string }[] => [
    { value: "warn", label: language.t("settings.router.budget.action.warn") },
    { value: "cap", label: language.t("settings.router.budget.action.cap") },
  ]

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.router.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <div class="flex flex-col gap-1">
          <SettingsList>
            <SettingsRow
              title={language.t("settings.router.enable.title")}
              description={language.t("settings.router.enable.description")}
            >
              <div data-action="settings-router-enabled">
                <Switch checked={router().enabled === true} onChange={(checked) => setRouter({ enabled: checked })} />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.router.mode.title")}
              description={language.t("settings.router.mode.description")}
            >
              <Select
                data-action="settings-router-mode"
                options={modeOptions()}
                current={modeOptions().find((o) => o.value === (router().mode ?? "observe"))}
                value={(o) => o.value}
                label={(o) => o.label}
                onSelect={(option) => option && setRouter({ mode: option.value as RouterMode })}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "180px" }}
              />
            </SettingsRow>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.router.tier.title")}</h3>
          <SettingsList>
            {TIER_NAMES.map((tier) => (
              <SettingsRow title={tier} description={language.t("settings.router.tier.description")}>
                <div class="flex items-center gap-2 w-full sm:w-[280px]">
                  <TextField
                    data-action={`settings-router-tier-${tier.toLowerCase()}`}
                    hideLabel
                    type="text"
                    value={router().tiers?.[tier] ?? ""}
                    onChange={(value) => setTier(tier, value)}
                    placeholder="provider/model"
                    spellcheck={false}
                    autocorrect="off"
                    autocomplete="off"
                    autocapitalize="off"
                    class="flex-1 text-12-regular"
                  />
                  <TierModelPicker
                    tier={tier}
                    value={router().tiers?.[tier]}
                    onSelect={(value) => setTier(tier, value)}
                  />
                </div>
              </SettingsRow>
            ))}
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.router.budget.title")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.router.budget.limit.description")}
              description={language.t("settings.router.budget.action.description")}
            >
              <div class="flex items-center gap-2">
                <div class="w-full sm:w-[140px]">
                  <TextField
                    data-action="settings-router-budget-limit"
                    hideLabel
                    type="number"
                    value={budget().limitUsd?.toString() ?? ""}
                    onChange={(value) => {
                      const trimmed = value.trim()
                      if (trimmed === "") return setBudget({ limitUsd: undefined })
                      const parsed = Number(trimmed)
                      setBudget({ limitUsd: Number.isFinite(parsed) ? parsed : undefined })
                    }}
                    placeholder="0.00"
                    class="text-12-regular"
                  />
                </div>
                <Select
                  data-action="settings-router-budget-action"
                  options={budgetActions()}
                  current={budgetActions().find((o) => o.value === (budget().action ?? "warn"))}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(option) => option && setBudget({ action: option.value })}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </div>
  )
}

/** Dropdown that lists imported models and fills the tier's TextField on select. */
function TierModelPicker(props: {
  tier: string
  value?: string
  onSelect: (value: string) => void
}) {
  const language = useLanguage()
  const models = useModels()
  const [open, setOpen] = createSignal(false)

  const all = createMemo(() =>
    models
      .list()
      .filter((item) => models.visible({ providerID: item.provider.id, modelID: item.id })),
  )

  const groups = createMemo<ModelGroup[]>(() => {
    const byProvider = new Map<string, ModelItem[]>()
    for (const item of all()) {
      byProvider.set(item.provider.id, [...(byProvider.get(item.provider.id) ?? []), item])
    }
    return Array.from(byProvider, ([providerID, items]) => ({
      providerID,
      providerName: items[0]?.provider.name ?? providerID,
      items,
    })).sort((a, b) => a.providerName.localeCompare(b.providerName))
  })

  const keyOf = (item: ModelItem) => `${item.provider.id}/${item.id}`
  const isCurrent = (item: ModelItem) => props.value === keyOf(item)

  return (
    <MenuV2 open={open()} onOpenChange={setOpen} placement="bottom-end" gutter={6} modal={false}>
      <MenuV2.Trigger
        as={(triggerProps) => (
          <ButtonV2
            {...triggerProps}
            variant="ghost-muted"
            size="small"
            class="shrink-0 px-2"
            aria-label={language.t("settings.router.tier.title")}
          >
            <Icon name="chevron-down" size="small" />
          </ButtonV2>
        )}
      />
      <MenuV2.Portal>
        <MenuV2.Content
          class="w-72 max-h-80 overflow-y-auto rounded-md border-0 bg-v2-background-bg-layer-01 !p-0 py-1 shadow-[var(--v2-elevation-floating)] focus:outline-none"
        >
          <Show
            when={all().length > 0}
            fallback={
              <div class="px-3 py-2 text-12-regular text-v2-text-text-faint">
                {language.t("dialog.model.empty")}
              </div>
            }
          >
            <For each={groups()}>
              {(group) => (
                <>
                  <div class="px-3 pb-1 pt-2 text-11-medium text-v2-text-text-faint">{group.providerName}</div>
                  <For each={group.items}>
                    {(item) => (
                      <MenuV2.Item
                        onSelect={() => {
                          props.onSelect(keyOf(item))
                          setOpen(false)
                        }}
                        class="flex items-center justify-between gap-2 px-3 py-1.5 text-13-regular text-v2-text-text-base"
                        classList={{
                          "bg-v2-overlay-simple-overlay-hover": isCurrent(item),
                        }}
                      >
                        <span class="min-w-0 truncate">{item.name}</span>
                        <Show when={isCurrent(item)}>
                          <span class="size-1.5 shrink-0 rounded-full bg-v2-icon-icon-muted" />
                        </Show>
                      </MenuV2.Item>
                    )}
                  </For>
                </>
              )}
            </For>
          </Show>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
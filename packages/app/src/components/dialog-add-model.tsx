import { useMutation } from "@tanstack/solid-query"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DialogBody, DialogHeader, DialogTitle, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { Match, Show, Switch as SolidSwitch, For, createMemo, createSignal, batch, type Accessor } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { showToast } from "@/utils/toast"
import { ProviderConnection } from "./dialog-connect-provider"
import { CustomProviderForm } from "./dialog-custom-provider"
import { modelRow, type ModelRow } from "./dialog-custom-provider-form"
import { SettingsListV2 } from "./settings-v2/parts/list"
import { SettingsRowV2 } from "./settings-v2/parts/row"

// "添加模型"对话框：合并原 Providers / Models 两个设置页的"新增"入口。
// 顶部提供商下拉框，下方配置项随选择动态切换：
//   - catalog-new        标准提供商未连接 → API Key / OAuth 连接表单
//   - catalog-connected  标准提供商已连接 → 该提供商模型可见性开关
//   - custom-new         自定义提供商新建 → 完整 CustomProviderForm
//   - custom-existing    已连接自定义提供商 → 追加模型行
const CUSTOM_NEW_ID = "__custom_new__"

type OptionKind = "catalog-new" | "catalog-connected" | "custom-new" | "custom-existing"
type ProviderOption = {
  id: string
  name: string
  kind: OptionKind
}

export function DialogAddModel(props: { directory?: Accessor<string | undefined> }) {
  const language = useLanguage()
  const serverSync = useServerSync()
  const providers = useProviders(props.directory)
  const [selection, setSelection] = createSignal<ProviderOption | null>(null)

  const isConfigCustom = (providerID: string) => {
    const provider = serverSync().data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  const options = createMemo<ProviderOption[]>(() => {
    const connected = new Set(providers.connected().map((p) => p.id))
    const list: ProviderOption[] = []
    for (const [id, p] of providers.all()) {
      const isCustom = isConfigCustom(id)
      const isConnected = connected.has(id)
      if (isConnected) {
        list.push({ id, name: p.name, kind: isCustom ? "custom-existing" : "catalog-connected" })
      } else {
        list.push({ id, name: p.name, kind: "catalog-new" })
      }
    }
    // 自定义 OpenAI 兼容提供商归入"可用的提供商"分组，并排在首位
    list.push({ id: CUSTOM_NEW_ID, name: language.t("dialog.provider.custom.label"), kind: "custom-new" })
    const rank = (opt: ProviderOption) => {
      if (opt.kind === "custom-new") return -1
      const i = popularProviders.indexOf(opt.id)
      return i >= 0 ? i : 999
    }
    list.sort((a, b) => {
      const ac = a.kind === "catalog-connected" || a.kind === "custom-existing"
      const bc = b.kind === "catalog-connected" || b.kind === "custom-existing"
      if (ac !== bc) return ac ? -1 : 1
      return rank(a) - rank(b)
    })
    return list
  })

  const groupFor = (opt: ProviderOption) => {
    if (opt.kind === "catalog-connected" || opt.kind === "custom-existing")
      return language.t("settings.providers.section.connected")
    return language.t("dialog.addModel.provider.group.available")
  }

  return (
    <DialogV2
      containerClass="!h-[min(calc(100vh_-_16px),560px)] !w-[min(calc(100vw_-_16px),640px)]"
      class="[font-family:var(--v2-font-family-sans)] [&_[data-slot=dialog-header]]:!px-5 [&_[data-slot=dialog-header-title]]:!text-[15px] [&_[data-slot=dialog-header-title]]:!tracking-[-0.13px]"
    >
      <DialogHeader closeLabel={language.t("common.close")}>
        <DialogTitle>{language.t("dialog.addModel.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="min-h-0 flex-1 overflow-hidden px-2 pb-2">
        <div class="flex min-h-0 flex-1 flex-col gap-3">
          <div class="shrink-0 px-3 pt-1">
            <label class="mb-1 block text-[13px] font-[530] leading-4 text-v2-text-text-base">
              {language.t("dialog.addModel.provider.label")}
            </label>
            <SelectV2
              appearance="base"
              class="!w-full"
              options={options()}
              current={selection() ?? undefined}
              value={(o) => o.id}
              label={(o) => o.name}
              groupBy={groupFor}
              placeholder={language.t("dialog.addModel.provider.placeholder")}
              onSelect={(o) => setSelection(o)}
            >
              {(o) => (
                <div class="flex min-w-0 items-center gap-2">
                  <ProviderIcon
                    id={o.id === CUSTOM_NEW_ID ? "synthetic" : o.id}
                    class="size-4 shrink-0 text-v2-icon-icon-base"
                  />
                  <span class="min-w-0 truncate font-[530] text-v2-text-text-base">{o.name}</span>
                  <Show when={o.kind === "catalog-connected" || o.kind === "custom-existing"}>
                    <span class="ml-auto shrink-0 rounded-xs border-[0.5px] border-v2-border-border-base bg-v2-background-bg-layer-03 px-1 text-[11px] font-[530] leading-4 tracking-[0.05px] text-v2-text-text-muted">
                      {language.t("dialog.addModel.provider.connected")}
                    </span>
                  </Show>
                </div>
              )}
            </SelectV2>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto">
            <Show when={selection()} keyed>
              {(opt) => <SelectedForm option={opt} directory={props.directory} onReset={() => setSelection(null)} />}
            </Show>
            <Show when={!selection()}>
              <div class="flex h-32 items-center justify-center px-6 text-center text-[13px] font-[440] leading-5 text-v2-text-text-muted">
                {language.t("dialog.addModel.placeholder")}
              </div>
            </Show>
          </div>
        </div>
      </DialogBody>
    </DialogV2>
  )
}

function SelectedForm(props: {
  option: ProviderOption
  directory?: Accessor<string | undefined>
  onReset: () => void
}) {
  return (
    <SolidSwitch>
      <Match when={props.option.kind === "catalog-new"}>
        <ProviderConnection
          provider={props.option.id}
          directory={props.directory}
          onBack={props.onReset}
          setBack={() => {}}
        />
      </Match>
      <Match when={props.option.kind === "custom-new"}>
        <CustomProviderForm />
      </Match>
      <Match when={props.option.kind === "custom-existing"}>
        <AddModelToCustomForm providerID={props.option.id} onDone={props.onReset} />
      </Match>
      <Match when={props.option.kind === "catalog-connected"}>
        <ConnectedProviderModels providerID={props.option.id} />
      </Match>
    </SolidSwitch>
  )
}

// 形态 B：标准提供商已连接 — 展示该提供商模型可见性开关。
function ConnectedProviderModels(props: { providerID: string }) {
  const language = useLanguage()
  const models = useModels()
  const items = createMemo(() => models.list().filter((m) => m.provider.id === props.providerID))
  return (
    <div class="flex flex-col gap-3 px-3 pb-4">
      <div class="text-[13px] font-[440] leading-5 text-v2-text-text-muted">
        {language.t("dialog.addModel.connected.description")}
      </div>
      <Show
        when={items().length > 0}
        fallback={<div class="text-[13px] text-v2-text-text-muted">{language.t("dialog.model.empty")}</div>}
      >
        <SettingsListV2>
          <For each={items()}>
            {(item) => {
              const key = { providerID: item.provider.id, modelID: item.id }
              return (
                <SettingsRowV2 title={item.name} description="">
                  <Switch checked={models.visible(key)} onChange={(c) => models.setVisibility(key, c)} hideLabel>
                    {item.name}
                  </Switch>
                </SettingsRowV2>
              )
            }}
          </For>
        </SettingsListV2>
      </Show>
    </div>
  )
}

// 形态 D：已连接自定义提供商 — 追加模型行到该 provider 的 config.models。
function AddModelToCustomForm(props: { providerID: string; onDone: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()

  const existingConfig = createMemo(() => serverSync().data.config.provider?.[props.providerID])
  const existingModelIDs = createMemo(() => new Set(Object.keys(existingConfig()?.models ?? {})))
  const providerName = () => existingConfig()?.name ?? props.providerID
  const baseURL = () => existingConfig()?.options?.baseURL

  const [form, setForm] = createStore<{ models: ModelRow[] }>({ models: [modelRow()] })

  const addModel = () => setForm("models", produce((rows) => rows.push(modelRow())))
  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm("models", produce((rows) => rows.splice(index, 1)))
  }
  const setModel = (index: number, key: "id" | "name" | "context", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const t = language.t
    const seen = new Set<string>()
    const errs = form.models.map((m) => {
      const id = m.id.trim()
      const idErr = !id
        ? t("provider.custom.error.required")
        : existingModelIDs().has(id) || seen.has(id)
          ? t("provider.custom.error.duplicate")
          : (() => {
              seen.add(id)
              return undefined
            })()
      const nameErr = !m.name.trim() ? t("provider.custom.error.required") : undefined
      const ctx = m.context.trim()
      const ctxErr =
        ctx && (!/^\d+$/.test(ctx) || Number(ctx) <= 0) ? t("provider.custom.models.context.invalid") : undefined
      return { id: idErr, name: nameErr, context: ctxErr }
    })
    batch(() => {
      errs.forEach((err, index) => setForm("models", index, "err", err))
    })
    return errs.every((e) => !e.id && !e.name && !e.context)
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      if ((await serverSDK().protocol) !== "v1") throw new Error(language.t("provider.custom.unavailable"))
      const existing = existingConfig()
      const entries = Object.fromEntries(
        form.models
          .filter((m) => m.id.trim())
          .map((m) => {
            const entry: { name?: string; limit?: { context: number; output: number } } = { name: m.name.trim() }
            const ctx = Number(m.context.trim())
            if (Number.isInteger(ctx) && ctx > 0) entry.limit = { context: ctx, output: 0 }
            return [m.id.trim(), entry]
          }),
      )
      const mergedModels = { ...(existing?.models ?? {}), ...entries }
      await serverSync().updateConfig({
        provider: { [props.providerID]: { ...existing, models: mergedModels } },
      })
    },
    onSuccess: () => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.addModel.custom.append.success.title"),
        description: language.t("dialog.addModel.custom.append.success.description", { provider: providerName() }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return
    if (!validate()) return
    saveMutation.mutate()
  }

  return (
    <form onSubmit={save} class="flex flex-col gap-5 px-3 pb-4">
      <div class="flex flex-col gap-1">
        <div class="text-[15px] font-[530] leading-5 text-v2-text-text-base">{providerName()}</div>
        <Show when={baseURL()}>
          <div class="break-all font-mono text-[12px] text-v2-text-text-muted">{baseURL()}</div>
        </Show>
        <div class="text-[13px] font-[440] leading-5 text-v2-text-text-muted">
          {language.t("dialog.addModel.custom.append.description")}
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <label class="text-[12px] font-[530] text-v2-text-text-muted">
          {language.t("provider.custom.models.label")}
        </label>
        <For each={form.models}>
          {(m, i) => (
            <div class="flex items-start gap-2">
              <div class="flex-1">
                <TextField
                  label={language.t("provider.custom.models.id.label")}
                  hideLabel
                  placeholder={language.t("provider.custom.models.id.placeholder")}
                  value={m.id}
                  onChange={(v) => setModel(i(), "id", v)}
                  validationState={m.err.id ? "invalid" : undefined}
                  error={m.err.id}
                />
              </div>
              <div class="flex-1">
                <TextField
                  label={language.t("provider.custom.models.name.label")}
                  hideLabel
                  placeholder={language.t("provider.custom.models.name.placeholder")}
                  value={m.name}
                  onChange={(v) => setModel(i(), "name", v)}
                  validationState={m.err.name ? "invalid" : undefined}
                  error={m.err.name}
                />
              </div>
              <div class="w-32 shrink-0">
                <TextField
                  label={language.t("provider.custom.models.context.label")}
                  hideLabel
                  placeholder={language.t("provider.custom.models.context.placeholder")}
                  value={m.context}
                  onChange={(v) => setModel(i(), "context", v)}
                  validationState={m.err.context ? "invalid" : undefined}
                  error={m.err.context}
                />
              </div>
              <IconButton
                type="button"
                icon="trash"
                variant="ghost"
                class="shrink-0"
                onClick={() => removeModel(i())}
                disabled={form.models.length <= 1}
                aria-label={language.t("provider.custom.models.remove")}
              />
            </div>
          )}
        </For>
        <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
          {language.t("provider.custom.models.add")}
        </Button>
      </div>

      <Button class="w-auto self-start" type="submit" size="large" variant="primary" disabled={saveMutation.isPending}>
        {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
      </Button>
    </form>
  )
}

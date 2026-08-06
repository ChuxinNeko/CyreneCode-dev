import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { useMutation } from "@tanstack/solid-query"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@/utils/toast"
import { batch, createSignal, type ComponentProps, For, Show, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { ExternalLink } from "@/components/external-link"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { type FormState, headerRow, modelRow, validateCustomProvider } from "./dialog-custom-provider-form"

// OpenAI-compatible 提供商的模型列表接口一般为 `{baseURL}/models`，但部分提供商
// 的 baseURL 只填到域名（https://api.example.com），此时按用户约定拼 /v1/models。
// baseURL 以 /v1（或 /v2 等版本号）结尾时，补 /models。
function modelsEndpoint(baseURL: string): string {
  const base = baseURL.trim().replace(/\/+$/, "")
  if (/\/v\d+\/models$/i.test(base) || /\/models$/i.test(base)) return base
  if (/\/v\d+$/i.test(base)) return `${base}/models`
  return `${base}/v1/models`
}

async function fetchProviderModels(baseURL: string, apiKey: string): Promise<string[]> {
  const response = await fetch(modelsEndpoint(baseURL), {
    headers: {
      accept: "application/json",
      ...(apiKey.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {}),
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const payload: unknown = await response.json()
  const data = Array.isArray((payload as { data?: unknown })?.data) ? (payload as { data: unknown[] }).data : []
  const ids = data.map((item) => (item as { id?: unknown })?.id).filter((id): id is string => typeof id === "string")
  if (ids.length === 0) throw new Error("empty")
  return ids
}

// 每个模型行一个拉取按钮：点击优先拉取 provider 的模型列表，成功后弹出 dropdown，
// 选中某个模型后把 id 快速填充到该行的 model-id 输入框。
type ModelFetchTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">

function FetchModelsMenu(props: {
  baseURL: () => string
  apiKey: () => string
  onSelect: (modelID: string) => void
  trigger: (triggerProps: ModelFetchTriggerProps) => JSX.Element
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [models, setModels] = createSignal<string[]>([])

  // 用 busy 标志防重复拉取，不依赖 Kobalte trigger 的响应式 disabled（其 `as`
  // 渲染函数不会随外层 baseURL/loading 信号自动重算）。
  let busy = false
  const close = () => setOpen(false)

  const load = async () => {
    if (busy) return
    if (!props.baseURL().trim()) {
      showToast({
        title: language.t("provider.custom.models.fetch.failed"),
        description: language.t("provider.custom.models.fetch.baseURLRequired"),
      })
      return
    }
    busy = true
    try {
      const ids = await fetchProviderModels(props.baseURL(), props.apiKey())
      setModels(ids)
      // 拉取成功后才弹出 dropdown。
      setOpen(true)
    } catch (err) {
      setModels([])
      showToast({
        title: language.t("provider.custom.models.fetch.failed"),
        description:
          err instanceof Error && err.message === "empty"
            ? language.t("provider.custom.models.fetch.empty")
            : err instanceof Error
              ? err.message
              : String(err),
      })
    } finally {
      busy = false
    }
  }

  return (
    <Kobalte
      open={open()}
      onOpenChange={(next) => {
        if (!next) {
          close()
          return
        }
        // 打开时先拉取、成功后弹出（不依赖 Kobalte 自动开合）。
        void load()
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as={(triggerProps: ModelFetchTriggerProps) => props.trigger(triggerProps)} />
      <Kobalte.Portal>
        <Kobalte.Content class="z-50 w-64 max-h-72 min-w-0 overflow-auto rounded-md border border-border-base bg-surface-raised-stronger-non-alpha p-1 shadow-md outline-none">
          <Kobalte.Title class="sr-only">{language.t("provider.custom.models.fetch")}</Kobalte.Title>
          <Show
            when={models().length > 0}
            fallback={
              <div class="px-3 py-4 text-13-regular text-text-weak">{language.t("provider.custom.models.fetch.empty")}</div>
            }
          >
            <For each={models()}>
              {(id) => (
                <button
                  type="button"
                  class="block w-full truncate rounded px-3 py-1.5 text-left text-13-regular hover:bg-surface-transparent"
                  onClick={() => {
                    props.onSelect(id)
                    close()
                  }}
                >
                  {id}
                </button>
              )}
            </For>
          </Show>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

type Props = {
  onBack: () => void
}

export function DialogCustomProvider(props: Props) {
  const language = useLanguage()

  return (
    <Dialog
      class="h-full"
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={props.onBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <CustomProviderForm />
    </Dialog>
  )
}

export function CustomProviderForm(props: { autofocus?: boolean } = {}) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const language = useLanguage()

  const [form, setForm] = createStore<FormState>({
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [modelRow()],
    headers: [headerRow()],
    err: {},
  })

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name" | "context", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: serverSync().data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(serverSync().data.provider.all.keys()),
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      if ((await serverSDK().protocol) !== "v1") throw new Error(language.t("provider.custom.unavailable"))
      const disabledProviders = serverSync().data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await serverSDK().client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await serverSync().updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
      return result
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
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

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
      <div class="px-2.5 flex gap-4 items-center">
        <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
        <div class="text-16-medium text-text-strong">{language.t("provider.custom.title")}</div>
      </div>

      <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
        <p class="text-14-regular text-text-base">
          {language.t("provider.custom.description.prefix")}
          <ExternalLink href="https://opencode.ai/docs/providers/#custom-provider" tabIndex={-1}>
            {language.t("provider.custom.description.link")}
          </ExternalLink>
          {language.t("provider.custom.description.suffix")}
        </p>

        <div class="flex flex-col gap-4">
          <TextField
            autofocus={props.autofocus ?? true}
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            onChange={(v) => setField("providerID", v)}
            validationState={form.err.providerID ? "invalid" : undefined}
            error={form.err.providerID}
          />
          <TextField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            onChange={(v) => setField("name", v)}
            validationState={form.err.name ? "invalid" : undefined}
            error={form.err.name}
          />
          <TextField
            label={language.t("provider.custom.field.baseURL.label")}
            placeholder={language.t("provider.custom.field.baseURL.placeholder")}
            value={form.baseURL}
            onChange={(v) => setField("baseURL", v)}
            validationState={form.err.baseURL ? "invalid" : undefined}
            error={form.err.baseURL}
          />
          <TextField
            label={language.t("provider.custom.field.apiKey.label")}
            placeholder={language.t("provider.custom.field.apiKey.placeholder")}
            description={language.t("provider.custom.field.apiKey.description")}
            value={form.apiKey}
            onChange={(v) => setField("apiKey", v)}
          />
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.models.label")}</label>
          <For each={form.models}>
            {(m, i) => (
              <div class="flex gap-2 items-start" data-row={m.row}>
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
                <div class="flex flex-col gap-1.5">
                  <FetchModelsMenu
                    baseURL={() => form.baseURL}
                    apiKey={() => form.apiKey}
                    onSelect={(id) => setModel(i(), "id", id)}
                    trigger={(triggerProps: ModelFetchTriggerProps) => (
                      <Button
                        {...triggerProps}
                        type="button"
                        size="small"
                        variant="ghost"
                        icon="arrow-down-to-line"
                        class="shrink-0"
                        aria-label={language.t("provider.custom.models.fetch")}
                      />
                    )}
                  />
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
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel} class="self-start">
            {language.t("provider.custom.models.add")}
          </Button>
        </div>

        <div class="flex flex-col gap-3">
          <label class="text-12-medium text-text-weak">{language.t("provider.custom.headers.label")}</label>
          <For each={form.headers}>
            {(h, i) => (
              <div class="flex gap-2 items-start" data-row={h.row}>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.key.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.key.placeholder")}
                    value={h.key}
                    onChange={(v) => setHeader(i(), "key", v)}
                    validationState={h.err.key ? "invalid" : undefined}
                    error={h.err.key}
                  />
                </div>
                <div class="flex-1">
                  <TextField
                    label={language.t("provider.custom.headers.value.label")}
                    hideLabel
                    placeholder={language.t("provider.custom.headers.value.placeholder")}
                    value={h.value}
                    onChange={(v) => setHeader(i(), "value", v)}
                    validationState={h.err.value ? "invalid" : undefined}
                    error={h.err.value}
                  />
                </div>
                <IconButton
                  type="button"
                  icon="trash"
                  variant="ghost"
                  class="mt-1.5"
                  onClick={() => removeHeader(i())}
                  disabled={form.headers.length <= 1}
                  aria-label={language.t("provider.custom.headers.remove")}
                />
              </div>
            )}
          </For>
          <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader} class="self-start">
            {language.t("provider.custom.headers.add")}
          </Button>
        </div>

        <Button
          class="w-auto self-start"
          type="submit"
          size="large"
          variant="primary"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
        </Button>
      </form>
    </div>
  )
}

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogConnectProvider, useProviderConnectController } from "@/components/dialog-connect-provider"

const CUSTOM_ID = "_custom"

/**
 * 首次启动欢迎页：主要引导用户手动配置模型。
 * 配置完成后由 NewHome 依据 providers.connected() 自动切回正常主页（WelcomeView）。
 * 文案沿用 home 现有的中文硬编码风格。
 */
export function OnboardingView(props: { onDismiss: () => void }) {
  const dialog = useDialog()
  const controller = useProviderConnectController()

  const openConnect = () => {
    controller.select(undefined)
    void dialog.show(() => <DialogConnectProvider controller={controller} />)
  }
  const openCustom = () => {
    controller.select(CUSTOM_ID)
    void dialog.show(() => <DialogConnectProvider controller={controller} />)
  }

  return (
    <div class="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 py-10">
        <div class="flex flex-col items-center gap-4 text-center">
          <div class="flex size-14 items-center justify-center rounded-[16px] bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-raised)]">
            <Icon name="settings-gear" class="size-7 text-v2-icon-icon-accent" />
          </div>
          <h1 class="text-[32px] font-semibold leading-tight text-v2-text-text-base tracking-[-0.04px]">
            欢迎使用 NekoCode
          </h1>
          <p class="max-w-[420px] text-[14px] leading-6 text-v2-text-text-muted">
            首次使用前，请先配置一个模型提供方。本版本不再内置免费模型，连接你常用的
            AI 服务（Anthropic、OpenAI、OpenRouter 等）或自定义 OpenAI 兼容接口即可开始。
          </p>
        </div>

        <div class="flex w-full max-w-[300px] flex-col gap-2.5">
          <ButtonV2
            type="button"
            variant="contrast"
            size="large"
            data-action="onboarding-configure-model"
            onClick={openConnect}
          >
            配置模型
          </ButtonV2>
          <ButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            data-action="onboarding-custom-provider"
            onClick={openCustom}
          >
            自定义 OpenAI 兼容服务
          </ButtonV2>
        </div>

        <div class="flex flex-col items-center gap-2">
          <button
            type="button"
            data-action="onboarding-dismiss"
            class="cursor-pointer text-[13px] font-[440] leading-none tracking-[-0.04px] text-v2-text-text-faint transition-[color] duration-150 ease-in-out hover:text-v2-text-text-muted focus-visible:outline-none"
            onClick={props.onDismiss}
          >
            稍后再说
          </button>
          <p class="text-[12px] leading-4 tracking-[-0.04px] text-v2-text-text-faint">
            需要自备对应服务的 API Key
          </p>
        </div>
      </div>
    </div>
  )
}

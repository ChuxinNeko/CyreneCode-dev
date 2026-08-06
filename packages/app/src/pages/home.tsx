import { Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSync } from "@/context/server-sync"
import { useProviders } from "@/hooks/use-providers"
import { Persist, persisted } from "@/utils/persist"
import { OnboardingView } from "./home/onboarding-view"
import { WelcomeView } from "./home/welcome-view"

export function NewHome() {
  const serverSync = useServerSync()
  const providers = useProviders(() => undefined)
  const [onboarding, setOnboarding] = persisted(
    Persist.global("onboarding.model-config", ["onboarding.model-config.v1"]),
    createStore<{ dismissed: boolean }>({ dismissed: false }),
  )

  // 一旦配置好模型就清除标志；将来若再次回到无模型状态，欢迎页可重新出现。
  createEffect(() => {
    if (providers.connected().length > 0) setOnboarding("dismissed", false)
  })

  const showOnboarding = createMemo(
    () => serverSync().data.ready && !onboarding.dismissed && providers.connected().length === 0,
  )

  // TEMP: onboarding 诊断日志
  createEffect(() => {
    console.log("[onboarding-dbg]", JSON.stringify({
      ready: serverSync().data.ready,
      dismissed: onboarding.dismissed,
      connectedCount: providers.connected().length,
      connectedIds: providers.connected().map((p) => p.id),
      show: showOnboarding(),
    }))
  })

  return (
    <Show when={showOnboarding()} fallback={<WelcomeView />}>
      <OnboardingView onDismiss={() => setOnboarding("dismissed", true)} />
    </Show>
  )
}

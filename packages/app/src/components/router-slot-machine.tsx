import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { useLanguage } from "@/context/language"

/**
 * Slot-machine-style model picker shown while a turn is being routed.
 *
 * Scrolls through the router's candidate models, then lands on the model the
 * assistant actually used for the turn. Simple single-line roll — no fancy
 * animation, per the product ask.
 */
export function RouterSlotMachine(props: {
  /** Model display names the router may pick between (from router.tiers). */
  candidates: readonly string[]
  /** The model actually routed for the turn; when present the roll stops here. */
  landed?: string
}) {
  const language = useLanguage()
  const [index, setIndex] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined

  createEffect(() => {
    if (props.landed) {
      if (timer) clearInterval(timer)
      timer = undefined
      return
    }
    if (timer || props.candidates.length === 0) return
    timer = setInterval(() => {
      setIndex((current) => (current + 1) % props.candidates.length)
    }, 120)
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  const display = () => props.landed ?? props.candidates[index()] ?? ""

  return (
    <div data-slot="session-turn-router" class="flex items-center gap-2 px-4 md:px-5 pt-1 text-11-medium text-text-weak">
      <Show when={!props.landed}>
        <TextShimmer text={language.t("model.router.selecting")} />
      </Show>
      <Show when={props.landed}>
        <span>{language.t("model.router.label")}</span>
        <span class="text-text-strong">{display()}</span>
      </Show>
      <Show when={!props.landed && display()}>
        <span class="text-text-strong">{display()}</span>
      </Show>
    </div>
  )
}
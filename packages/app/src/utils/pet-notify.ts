import type { PetEventName } from "@/pet"

// Bridges OpenCode's session lifecycle events to the desktop pet's animation
// triggers. The renderer side owns the actual animation state machine; this
// module only decides *when* to nudge it.

type AnySessionEvent = {
  type: string
  properties?: { sessionID?: string; status?: { type: string } }
  data?: { sessionID?: string }
}

// Maps a single OpenCode session event to a pet trigger. Returns null when the
// event carries no pet-relevant signal (the vast majority of events).
export function petEventForSessionEvent(event: AnySessionEvent): PetEventName | null {
  switch (event.type) {
    case "session.execution.started":
      // The agent is about to reason — pet enters the "thinking" pose.
      return "thinking"
    case "session.execution.succeeded":
      // Turn finished successfully — pet jumps (success), then reviews below.
      return "success"
    case "session.execution.failed":
    case "session.retry.scheduled":
      // Something went wrong — pet shows the "failed" pose.
      return "error"
    case "session.execution.interrupted":
      // Cancelled by the user — back to idle.
      return "idle"
    case "session.compacted":
      // The model reviewed/condensed its context — pet "reviews" the work.
      return "review"
    case "session.status": {
      const status = event.properties?.status
      if (!status) return null
      if (status.type === "busy") return "running"
      if (status.type === "retry") return "error"
      if (status.type === "idle") return "idle"
      return null
    }
    default:
      return null
  }
}

// Tracks the last trigger so we don't spam the pet with identical consecutive
// state changes (e.g. repeated `busy` status pings while the agent keeps
// working on the same turn).
let lastEvent: PetEventName | null = null

export function notifyPet(name: PetEventName): void {
  if (name === lastEvent) return
  lastEvent = name
  try {
    void window.api?.petNotify?.({ name })
  } catch {
    // The pet overlay may not be running (disabled or not yet created).
    // Notifying is best-effort; swallow any error.
  }
}

// Convenience: map + notify for a session event, with the one special-case
// sequencing (success is followed by a brief "review" beat).
export function notifyPetSessionEvent(event: AnySessionEvent): void {
  const name = petEventForSessionEvent(event)
  if (!name) return
  notifyPet(name)
  if (name === "success") {
    // After a successful turn, the pet "reviews" what it just produced.
    // Delay so the success (jump) animation is fully visible first.
    setTimeout(() => notifyPet("review"), 1600)
  }
}

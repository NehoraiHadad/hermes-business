import { useCallback, useEffect, useRef, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'

// תכל'ס (companion) self-update check, renderer side (docs/specs/versioning.md
// §6.4/§6.5/§13 stage 4). Owns exactly the UI-facing state machine:
//   verdict === null            → 'לא נבדק' (no check has ever completed, active
//                                  or passive — matches the Hermes row's own
//                                  default, SupportUpdatePanel.tsx)
//   verdict.status === '...'    → one of the four proven verdicts from main
// The actual network/parse/decision work is 100% main-process (companion-update.cjs);
// this hook only calls check() (explicit, via hermesClient.checkCompanionUpdate)
// and subscribes to the passive one-shot push (hermesClient.onCompanionUpdateAvailable).

const DISMISSED_VERSION_KEY = 'tachles.companionUpdate.dismissedVersion'

// localStorage here is a DISPLAY-ONLY "have I already shown this version to the
// user" marker — not a security or correctness boundary and not the source of
// truth for the verdict itself (that always comes fresh from the main-process
// check). Worst case on a failed/cleared read is the same update gets pointed
// out again, which is harmless; so every access is best-effort and never throws.
//
// Exported (B1, docs/specs/versioning.md §7.2): FullAppShell.tsx's always-mounted
// passive-update toast/nav-indicator reads and writes the SAME key through these
// same two functions, rather than reimplementing the read/write — one seen-marker,
// shared by the support screen's own hook instance and the always-mounted banner.
export function readDismissedVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_VERSION_KEY)
  } catch {
    return null
  }
}

export function writeDismissedVersion(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_VERSION_KEY, version)
  } catch {
    /* best effort — a failed write just means the badge may reappear */
  }
}

export type UseCompanionUpdate = {
  /** null = 'לא נבדק' (§7.1) — no check (active or passive) has completed yet. */
  verdict: CompanionUpdateStatus | null
  checking: boolean
  /** Last version the user has already seen surfaced, persisted (display-only, see above). */
  dismissedVersion: string | null
  check: (force?: boolean) => Promise<CompanionUpdateStatus>
  /** Marks a version as seen so a future re-render doesn't re-announce it. */
  dismiss: (version: string) => void
}

export function useCompanionUpdate(): UseCompanionUpdate {
  const [verdict, setVerdict] = useState<CompanionUpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => readDismissedVersion())
  // Guards state updates after unmount (the passive-push subscription and any
  // in-flight check() promise can both resolve after the component is gone).
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Passive path (§6.5): the main process pushes a ONE-SHOT event only when its
  // startup timer found update-available. Subscribing — instead of polling —
  // means the support screen reflects a passive discovery made while it was
  // mounted, without an extra request of its own.
  useEffect(() => {
    return hermesClient.onCompanionUpdateAvailable(status => {
      if (mounted.current) setVerdict(status)
    })
  }, [])

  const check = useCallback(async (force = false) => {
    setChecking(true)
    try {
      // checkCompanionUpdate NEVER rejects on the main-process side (§8
      // fail-closed contract) — a missing bridge is the one path that can still
      // reject here (createHermesDesktop's need()), which callers handle like
      // any other facade call.
      const result = await hermesClient.checkCompanionUpdate(force)
      if (mounted.current) setVerdict(result)
      return result
    } finally {
      if (mounted.current) setChecking(false)
    }
  }, [])

  const dismiss = useCallback((version: string) => {
    writeDismissedVersion(version)
    setDismissedVersion(version)
  }, [])

  return { verdict, checking, dismissedVersion, check, dismiss }
}

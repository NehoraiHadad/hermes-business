import { useCallback, useEffect, useRef, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'

// תכל'ס (companion) self-update, renderer side (docs/specs/versioning.md
// §6.4/§6.5/§7/§13 stage 4). Owns exactly the UI-facing state machine:
//   verdict === null            → 'לא נבדק' (no check has ever completed, active
//                                  or passive — matches the Hermes row's own
//                                  default, SupportUpdatePanel.tsx)
//   verdict.status === '...'    → one of the four proven verdicts from main
//   phase                       → where the CONSENTED action stands right now
// The actual network/parse/decision work is 100% main-process (companion-update.cjs,
// companion-download.cjs, companion-apply.cjs); this hook only calls the four
// no-argument actions on the facade and subscribes to the two pushes.
//
// Nothing here computes an operand for main: not a URL, not a path, not a
// version. Main derives all of them from artifacts it produced itself, which is
// why every action below is a bare call — there is genuinely nothing to pass.

const DISMISSED_VERSION_KEY = 'tachles.companionUpdate.dismissedVersion'

// Renderer-side acknowledgement of an UNRESOLVED apply (see `stuck` below).
// Deliberately a separate key from the seen-marker above: "I saw that a new
// version exists" and "I saw that an install did not confirm" are different
// facts about different events, and collapsing them would let a routine update
// notice silence a real unresolved state (or the reverse).
const ACKNOWLEDGED_APPLY_KEY = 'tachles.companionUpdate.acknowledgedApply'

// localStorage here is a DISPLAY-ONLY "have I already shown this version to the
// user" marker — not a security or correctness boundary and not the source of
// truth for the verdict itself (that always comes fresh from the main-process
// check). Worst case on a failed/cleared read is the same update gets pointed
// out again, which is harmless; so every access is best-effort and never throws.
//
// Exported (B1, docs/specs/versioning.md §7.2): FullAppShell.tsx's always-mounted
// passive-update banner reads and writes the SAME key through these
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

function readAcknowledgedApply(): string | null {
  try {
    return window.localStorage.getItem(ACKNOWLEDGED_APPLY_KEY)
  } catch {
    return null
  }
}

function writeAcknowledgedApply(marker: string): void {
  try {
    window.localStorage.setItem(ACKNOWLEDGED_APPLY_KEY, marker)
  } catch {
    /* best effort — a failed write just means the notice reappears next launch */
  }
}

/** Where the consented action stands. 'idle' = nothing of ours is running. */
export type CompanionUpdatePhase = 'idle' | 'downloading' | 'verifying' | 'ready' | 'applying'

/**
 * An apply that was launched and never confirmed — the launch-recovery outcomes
 * `applied-unhealthy` and `unexpected-version` (electron/companion-apply.cjs).
 * Main deliberately does NOT clear the journal for those two: the state is
 * genuinely unresolved, so nothing is destroyed and every launch re-checks. The
 * cost is that it can recur on every launch, which is why the panel offers a
 * renderer-side acknowledgement (`acknowledgeStuckApply`). We do not — and must
 * not — delete main's journal from here; there is no such API, and inventing one
 * would let the renderer erase the only record of an unresolved install.
 */
export type StuckApply = {
  targetVersion: string | null
  currentVersion: string
  /** true when the running version IS the target: it installed, but nothing proved it healthy. */
  reachedTarget: boolean
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

  // ---- consented one-click update (§7) -------------------------------------
  phase: CompanionUpdatePhase
  receivedBytes: number
  /** null = the response carried no usable length ⇒ the bar must be INDETERMINATE. */
  totalBytes: number | null
  /** The version the current download/ready offer is about, when one is known. */
  targetVersion: string | null
  /** Main's own Hebrew failure/refusal text, rendered verbatim. Never our words. */
  error: string | null
  /** The structured code behind `error` (e.g. 'cancelled'), for tone only. */
  errorCode: string | null
  download: () => Promise<void>
  cancel: () => Promise<void>
  apply: () => Promise<void>
  /** An unresolved apply from a previous launch, or null. */
  stuckApply: StuckApply | null
  acknowledgeStuckApply: () => void

  // ---- rollback to the previous version (§7.5) -----------------------------
  /** Main's offline verdict on whether a one-step rollback is possible, or null
   *  before the first read. `available:false` always carries a Hebrew `message`
   *  saying why — the panel shows it instead of hiding the capability silently. */
  rollbackOffer: CompanionRollbackOffer | null
  /** True when the pending `ready` offer is a DOWNGRADE rather than an update.
   *  Derived from main's `direction`, never from comparing version strings here:
   *  the one SemVer implementation lives in main, and '…alpha.10' sorts below
   *  '…alpha.9' under string comparison. */
  rollingBack: boolean
  rollback: () => Promise<void>
}

// A missing bridge is the ONE path that can still reject (createHermesDesktop's
// need()); main itself never rejects on these channels. It is still a failure
// and still leaves the machine untouched, so it gets the same honest shape.
const BRIDGE_FAILURE = 'לא ניתן לבצע את פעולת העדכון כרגע. לא בוצע שינוי.'

export function useCompanionUpdate(): UseCompanionUpdate {
  const [verdict, setVerdict] = useState<CompanionUpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() => readDismissedVersion())
  const [phase, setPhase] = useState<CompanionUpdatePhase>('idle')
  const [receivedBytes, setReceivedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState<number | null>(null)
  const [readyVersion, setReadyVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [stuckApply, setStuckApply] = useState<StuckApply | null>(null)
  const [rollbackOffer, setRollbackOffer] = useState<CompanionRollbackOffer | null>(null)
  const [rollingBack, setRollingBack] = useState(false)
  // Guards state updates after unmount (the two subscriptions and any in-flight
  // action promise can all resolve after the component is gone).
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

  // Streamed progress from the download engine. Subscribed for the hook's whole
  // life (not only while downloading) so a push that lands between our own
  // setState and the next render is never dropped, and unsubscribed on unmount.
  useEffect(() => {
    return hermesClient.onCompanionDownloadProgress(progress => {
      if (!mounted.current) return
      setReceivedBytes(progress.receivedBytes)
      setTotalBytes(progress.totalBytes)
      // 'manifest' is still part of "we are fetching things" as far as the owner
      // is concerned — it gets the downloading bar rather than a fourth label.
      setPhase(progress.phase === 'verifying' ? 'verifying' : progress.phase === 'ready' ? 'ready' : 'downloading')
    })
  }, [])

  // Adopt the durable journal on mount. This is how the launch-recovery
  // `resumable` outcome reaches the UI: a download that was verified in a
  // PREVIOUS session but never applied comes back as a `ready` offer, so the
  // owner is asked to consent to the install rather than to download again.
  //
  // Only 'ready' and 'applying' are adopted. A 'downloading'/'verifying' record
  // cannot describe THIS process (nothing of ours is in flight at mount, and
  // launch recovery discards those partials), so claiming one would be a lie.
  const adoptJournal = useCallback((state: CompanionUpdateJournalState) => {
    if (state.phase === 'ready' && state.targetVersion) {
      setReadyVersion(state.targetVersion)
      setRollingBack(state.direction === 'rollback')
      setPhase('ready')
      return
    }
    if (state.phase === 'applying') {
      // Left behind by an apply that was launched and never confirmed. We hold
      // the phase at 'idle' — this session is not installing anything — and
      // surface it as an unresolved notice instead.
      const marker = `${state.targetVersion ?? 'unknown'}@${state.currentVersion}`
      if (readAcknowledgedApply() !== marker) {
        setStuckApply({
          targetVersion: state.targetVersion,
          currentVersion: state.currentVersion,
          reachedTarget: state.targetVersion !== null && state.targetVersion === state.currentVersion
        })
      }
    }
  }, [])

  useEffect(() => {
    let abandoned = false
    hermesClient
      .companionUpdateState()
      .then(state => {
        if (abandoned || !mounted.current) return
        adoptJournal(state)
      })
      .catch(() => {
        // No bridge / no journal readable ⇒ no offer. Staying idle is the honest
        // outcome: we cannot prove a verified download is waiting.
      })
    return () => {
      abandoned = true
    }
  }, [adoptJournal])

  // Is a rollback possible? Offline on main's side (two local file reads), so it
  // costs nothing to ask on mount. A rejection means no bridge ⇒ no offer, which
  // is the fail-closed answer: we cannot prove a previous version ever ran here.
  useEffect(() => {
    let abandoned = false
    hermesClient
      .companionRollbackOffer()
      .then(offer => {
        if (abandoned || !mounted.current) return
        setRollbackOffer(offer)
      })
      .catch(() => {
        if (abandoned || !mounted.current) return
        setRollbackOffer({ available: false, target: null, from: null, code: 'bridge-unavailable', message: null })
      })
    return () => {
      abandoned = true
    }
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

  // Re-read main's journal and mirror it. Used after a refused apply so the UI
  // reflects what main actually still holds, instead of our own optimistic guess.
  const resyncFromJournal = useCallback(async () => {
    try {
      const state = await hermesClient.companionUpdateState()
      if (!mounted.current) return
      setPhase(state.phase === 'ready' && state.targetVersion ? 'ready' : 'idle')
      if (state.phase === 'ready' && state.targetVersion) {
        setReadyVersion(state.targetVersion)
        setRollingBack(state.direction === 'rollback')
      }
    } catch {
      if (mounted.current) setPhase('idle')
    }
  }, [])

  const download = useCallback(async () => {
    setError(null)
    setErrorCode(null)
    setReceivedBytes(0)
    setTotalBytes(null)
    setRollingBack(false)
    setPhase('downloading')
    try {
      const result = await hermesClient.downloadCompanionUpdate()
      if (!mounted.current) return
      if (result.ok) {
        setReadyVersion(result.version)
        setPhase('ready')
        return
      }
      // Includes the user's own cancel ('cancelled'). Main's message already
      // says, in Hebrew, what happened and that nothing was changed — we render
      // it verbatim rather than inventing a second vocabulary for the same event.
      setPhase('idle')
      setError(result.message)
      setErrorCode(result.code)
    } catch {
      if (!mounted.current) return
      setPhase('idle')
      setError(BRIDGE_FAILURE)
      setErrorCode('bridge-unavailable')
    }
  }, [])

  // Deliberately a SEPARATE action from `download`, not a parameter on it. The
  // two differ in the one way that matters — which direction the install moves —
  // and a boolean argument would put that choice on a call site instead of on a
  // distinct, separately-consented button the owner had to press.
  const rollback = useCallback(async () => {
    setError(null)
    setErrorCode(null)
    setReceivedBytes(0)
    setTotalBytes(null)
    setRollingBack(true)
    setPhase('downloading')
    try {
      const result = await hermesClient.downloadCompanionRollback()
      if (!mounted.current) return
      if (result.ok) {
        setReadyVersion(result.version)
        setPhase('ready')
        return
      }
      setPhase('idle')
      setRollingBack(false)
      setError(result.message)
      setErrorCode(result.code)
    } catch {
      if (!mounted.current) return
      setPhase('idle')
      setRollingBack(false)
      setError(BRIDGE_FAILURE)
      setErrorCode('bridge-unavailable')
    }
  }, [])

  const cancel = useCallback(async () => {
    try {
      await hermesClient.cancelCompanionDownload()
      // No state change here on purpose: the in-flight download() promise is what
      // reports the outcome (code 'cancelled'), so there is exactly one writer.
    } catch {
      /* nothing in flight to stop, or no bridge — never an error for the owner */
    }
  }, [])

  const apply = useCallback(async () => {
    setError(null)
    setErrorCode(null)
    setPhase('applying')
    try {
      const refusal = await hermesClient.applyCompanionUpdate()
      if (!mounted.current) return
      // REACHING HERE MEANS THE APPLY WAS REFUSED. On success the installer kills
      // this process, so the promise never settles and there is no success branch
      // that could ever run — writing one would be dead code pretending to be a
      // happy path. The only honest thing to do is surface main's refusal.
      setError(refusal.message)
      setErrorCode(refusal.code)
      await resyncFromJournal()
    } catch {
      if (!mounted.current) return
      setError(BRIDGE_FAILURE)
      setErrorCode('bridge-unavailable')
      setPhase('idle')
    }
  }, [resyncFromJournal])

  // Persisted per (target, running) pair rather than as a blanket "hide update
  // notices": a DIFFERENT unresolved apply later is a different fact and must
  // still be told. Renderer-side only — main's journal is untouched, so the
  // record of the unresolved install survives this acknowledgement.
  const acknowledgeStuckApply = useCallback(() => {
    if (stuckApply) writeAcknowledgedApply(`${stuckApply.targetVersion ?? 'unknown'}@${stuckApply.currentVersion}`)
    setStuckApply(null)
  }, [stuckApply])

  return {
    verdict,
    checking,
    dismissedVersion,
    check,
    dismiss,
    phase,
    receivedBytes,
    totalBytes,
    targetVersion: readyVersion ?? (verdict?.status === 'update-available' ? verdict.latest ?? null : null),
    error,
    errorCode,
    download,
    cancel,
    apply,
    stuckApply,
    acknowledgeStuckApply,
    rollbackOffer,
    rollingBack,
    rollback
  }
}

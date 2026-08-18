const nodeFs = require('node:fs')
const { rememberLog } = require('./logs.cjs')
const { fetchReleases } = require('./companion-update.cjs')
const { downloadCompanionUpdate } = require('./companion-download.cjs')
const { selectUpdateAssets } = require('./companion-download-core.cjs')
const journalModule = require('./companion-update-journal.cjs')
const core = require('./companion-rollback-core.cjs')
const { appVersion } = require('./app-version.cjs')

// IMPURE half of the rollback (F5): read the durable journal, locate the older
// release, and hand the ordinary download engine a target with
// `direction: 'rollback'`. Every DECISION lives in companion-rollback-core.cjs;
// this module owns only I/O and ordering.
//
// ── What is deliberately NOT rebuilt here ────────────────────────────────────
// A rollback reuses the forward path almost entirely, and that is the point:
//   * the SAME download engine streams and hashes the bytes, so the
//     authenticate-the-statement-then-hash-the-bytes ordering is not duplicated
//     (and cannot drift) for the backwards case;
//   * the SAME `verifyUpdateManifest` runs, with the SAME signature check and the
//     SAME `expectedVersion` anti-replay equality — only the ordering rule flips
//     from "strictly newer" to "strictly older";
//   * the SAME journal drives the SAME launch-time reconciliation, which already
//     decides purely by comparing the running version to `targetVersion` and is
//     therefore direction-agnostic with no changes at all;
//   * the SAME `applyCompanionUpdate` launches the installer with the SAME NSIS
//     argv. NSIS has no downgrade guard (verified against app-builder-lib's
//     templates: no version comparison exists anywhere in them), so installing an
//     older build over a newer one is an ordinary install.
// The only genuinely new logic is "which version, and may we go there at all" —
// which is exactly what the pure core answers.

const ROLLBACK_HISTORY_OUTCOME = 'applied-unhealthy'

function readHistoryEntries(read) {
  try {
    const parsed = read()
    return Array.isArray(parsed?.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

/**
 * Is a rollback on offer right now? Pure-ish: reads two local files, never the
 * network, so the UI can call it on mount without a request.
 *
 * Returns the core's verdict verbatim — `{ available, target, from, source,
 * code, message }` — so the renderer branches on the same codes the tests do.
 */
function resolveRollbackOffer({
  getVersion = appVersion,
  readJournal = () => journalModule.readCompanionJournal({}),
  readHistory = null
} = {}) {
  const historyReader =
    readHistory || (() => JSON.parse(nodeFs.readFileSync(journalModule.historyPath(), 'utf8')))
  return core.decideRollbackTarget({
    runningVersion: getVersion(),
    journal: readJournal(),
    history: readHistoryEntries(historyReader)
  })
}

/**
 * Download + verify the installer for the version this install came from.
 *
 * Never rejects: like `downloadCompanionUpdate`, every failure resolves to
 * `{ ok:false, code, message }` with Hebrew copy. On success the journal is left
 * at phase `ready` and the ORDINARY apply handler finishes the job — there is no
 * separate "apply a rollback" path to get out of step with the real one.
 */
async function downloadCompanionRollback(request = {}, deps = {}) {
  const {
    log = rememberLog,
    fetchImpl = fetch,
    getVersion = appVersion,
    resolveOffer = resolveRollbackOffer,
    fetchReleaseList = fetchReleases,
    selectRelease = core.selectRollbackRelease,
    selectAssets = selectUpdateAssets,
    download = downloadCompanionUpdate,
    clearJournal = opts => journalModule.clearCompanionJournal(opts),
    onProgress = null
  } = deps
  const { signal = null } = request || {}

  const offer = resolveOffer({ getVersion })
  if (!offer.available) {
    return { ok: false, code: offer.code, message: offer.message, detail: offer.detail }
  }
  const target = offer.target

  let feed
  try {
    feed = await fetchReleaseList(fetchImpl)
  } catch (error) {
    log(`Rollback release lookup failed: ${error?.message || error}`)
    return {
      ok: false,
      code: 'releases-unreachable',
      message: 'לא ניתן היה לפנות לשרת הגרסאות. בדקו את החיבור לאינטרנט ונסו שוב.',
      detail: String(error?.message || error)
    }
  }

  const found = selectRelease({ releases: feed?.releases, target })
  if (!found.ok) {
    // `truncated` is surfaced in the DETAIL, never used to soften the verdict:
    // "we only saw the first page" is a reason the target might exist elsewhere,
    // not evidence that it does. The user-facing message stays "not available".
    return {
      ok: false,
      code: found.code,
      message: found.message,
      detail: `${found.detail}${feed?.truncated ? ' (release list was truncated — only the first page was read)' : ''}`
    }
  }

  const assets = selectAssets({ assets: found.release.assets, version: target })
  if (!assets.ok) {
    return {
      ok: false,
      code: assets.code,
      message: 'הגרסה הקודמת אינה כוללת קובץ התקנה חתום, ולכן לא ניתן לחזור אליה אוטומטית.',
      detail: assets.detail
    }
  }

  // ── Archive the ACTIVE record BEFORE the download overwrites it ─────────────
  // `beginCompanionUpdate` (inside the download engine) overwrites any existing
  // journal atomically. When the rollback was offered on the strength of an
  // ACTIVE `applying` record — the `applied-unhealthy` state, the case that
  // matters most — that overwrite would destroy the very evidence the offer
  // rests on. If the download then failed, the journal would be cleared as
  // `failed`, history would hold no anchor, and the user would be left on a
  // broken version with the rollback button gone. Archiving first turns that
  // record into a durable history anchor (ROLLBACK_ANCHOR_OUTCOMES), so a failed
  // rollback is retryable instead of self-erasing.
  //
  // A failure to archive is NOT fatal: it would only cost us the retry
  // affordance, and refusing to roll back at all because a history file could
  // not be written would strand the user on the broken version for a strictly
  // worse reason.
  if (offer.source === 'journal') {
    try {
      clearJournal({ outcome: ROLLBACK_HISTORY_OUTCOME })
      log(`Archived the unhealthy v${offer.from} record as a rollback anchor before rolling back to v${target}`)
    } catch (error) {
      log(`Could not archive the active journal before rollback (continuing): ${error?.message || error}`)
    }
  }

  log(`Rolling back from v${offer.from} to v${target} (anchor: ${offer.source})`)
  const result = await download(
    {
      version: target,
      installerUrl: assets.installerUrl,
      manifestUrl: assets.manifestUrl,
      // The one flipped bit. Everything else about this download — signature,
      // expected-version equality, digest, artifact-name pin, journal — is the
      // forward path unchanged.
      direction: 'rollback',
      signal
    },
    // `getVersion` is threaded through DELIBERATELY rather than left to the
    // engine's own default. The offer above was decided against THIS reading of
    // the running version, and the engine uses its reading to write the journal's
    // `currentVersion` — the very field a FUTURE rollback offer reads back. Two
    // independent sources for one value is a seam where the recorded history can
    // disagree with the decision that produced it, so there is only one source.
    // (It also makes the module drivable outside Electron, which is how the crash
    // that exposed this was found.)
    { onProgress, getVersion, log }
  )
  if (!result.ok) return result
  return { ...result, rollback: true, from: offer.from, message: `הגרסה ${target} הורדה ואומתה` }
}

module.exports = {
  ROLLBACK_HISTORY_OUTCOME,
  resolveRollbackOffer,
  downloadCompanionRollback
}

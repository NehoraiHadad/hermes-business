# Changelog

כל השינויים המשמעותיים בתכל'ס מתועדים בקובץ זה. הפורמט מבוסס על
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) והגרסאות עוקבות אחר
[SemVer 2.0.0](https://semver.org/) עם תגי קדם־שחרור (`docs/specs/versioning.md`).

לכל גרסה שני תתי־סעיפים: **מה חדש (למשתמש)** בעברית — הסעיף שמועתק אל גוף
ה־GitHub Release ומוצג (מקוצר) באפליקציה עצמה — ו־**Technical** באנגלית, לצוות
הפיתוח.

---

## [0.4.0-alpha.2] - 2026-08-04

### מה חדש (למשתמש)

- **גרסת אלפא ראשונה לבודקים חיצוניים.** מעכשיו יש דרך רשמית להוריד ולהתקין
  את תכל'ס — גרסה אמיתית ומלאה, עם קובץ אימות (SHA256SUMS) ליד קובץ ההתקנה.
  הקובץ עדיין **לא חתום דיגיטלית**, כך ש־Windows SmartScreen יציג אזהרה
  בהתקנה; זה צפוי וזמני, ומתועד בעמוד ההורדה.
- **עדכון פעילות שותפים.** מסך המשימות מציג כעת פיד של פעילות אוטומטית
  ("שותף עסקי") — צ׳ק־אינים ותזכורות שהתבצעו ברקע — עם אפשרות לפתוח כל פריט
  ישירות בצ׳אט, ותג התראה בתפריט הניווט כשיש פעילות שלא נצפתה.
- **רענון חי, לא רק בכפתור.** מסכי המשימות/פעילות מתעדכנים אוטומטית ברגע
  שמשהו משתנה (משימה חדשה, סטטוס שיחה, חיבור פלטפורמה) — בלי לרענן ידנית
  ובלי בדיקות חוזרות מיותרות ברקע; יש גם רענון אוטומטי כשחוזרים לחלון או
  כשמתחדש חיבור הרשת.
- **בדיקת עדכון כנה + גילוי פסיבי.** מסך התמיכה כבר לא טוען סתם "מעודכן" —
  הוא בודק בפועל מול ההוצאות הרשמיות של תכל'ס ומציג את המצב האמיתי: יש
  עדכון / מעודכן / לא ידוע. כשיש גרסה חדשה, מופיעה הודעה חד־פעמית ונקודת
  התראה על כניסת מסך התמיכה — בלי חלון קופץ שחוסם. ההתקנה עצמה עדיין ידנית
  (מוריד ומריץ בעצמכם), כי הקובץ לא חתום.
- **דיוק גבוה יותר באבחון.** דוח האבחון (לשליחה לתמיכה) כולל כעת ציר זמן
  שגיאות ומידע גרסה/תאימות מדויק יותר, ותוקן פער בהצנעת נתיבים אישיים
  בחלונות (Windows) שיכול היה לחשוף שם משתמש בתוך דוח מיוצא.
- **אתר מידע ציבורי.** עמוד מידע סטטי בעברית (RTL) על תכל'ס, ללא צורך
  בהתקנה כדי לדעת מה זה.

### Technical

- **Release process, stage 5 (docs/specs/versioning.md §13):** added a third
  `--channel pilot` to the packaging orchestrator
  (`scripts/package-win.mjs`) and every gate module under
  `scripts/lib/release/*` (channel grouping centralized in the new
  `scripts/lib/release/channel-policy.mjs`: `requiresFullRigor` /
  `isSigningTolerant`). Pilot builds the REAL production renderer
  (`npm run build`, demo fixtures physically stripped) — never `build:qa` —
  and carries the SAME attestation / binding-chain / version-ledger /
  lock-integrity rigor and machine-bound `packaged-e2e` + `approval`
  evidence as `public`. It tolerates exactly two things, like `qa`: no
  code-signing certificate yet (unsigned PEs, `finalize-payload.mjs` /
  `sign-release.mjs` log an explicit Alpha-disclosure line instead of
  "non-distributable"), and the `thin-installer`/`telegram` external gates
  may stay honest blockers. `build/build-attestation.json` now records an
  independently-detected `build_mode: 'production'|'qa'|'unknown'` fact
  (scanned from the compiled `dist/` bundle for the demo-fixture-strip stub
  — never trusted from the `--channel` argument); `preflightRelease` fails a
  pilot release closed (`pilot-qa-mode-build`) unless it reads
  `'production'`. The `public` channel's existing gates are unchanged —
  every `channel === 'public'` branch evaluates identically to before (the
  only addition for public is the new attestation-schema gate below).
  New: `package:win:pilot` / `verify:release-contract:pilot` npm scripts,
  `scripts/verify-version-tag.mjs` (read-only tag↔`package.json` proof for
  the release checklist), `docs/RELEASING.md` (the full checklist).
  `docs/ACCEPTANCE.md` and `docs/release-contract.md` updated to define the
  pilot channel's meaning. Post-review hardening: unknown channel strings
  now THROW from every `channel-policy.mjs` predicate and from
  `checkGateStatuses` (previously fell through to the lenient side);
  `release-ledger.json` is authenticated PER ENTRY against
  `build/trust-roots.json`'s `github_asset_sha256` map, bidirectionally
  (never-shrinking enforced), with a committed empty pair as the documented
  first-release bootstrap; the attestation `schema` is a first-class
  preflight gate on every channel.
- **Partner-activity feed:** `electron/business-partner.cjs` /
  `partner-checkins.cjs` / `partner-cron.cjs` (main process) +
  `src/components/screens/PartnerFeedPanel.tsx` /
  `src/hooks/usePartnerFeed.ts` (renderer), wired into `TasksScreen.tsx`.
  Five explicit fail-closed display states — a failed read is never shown
  as "no activity."
- **Live refresh:** `src/lib/live-refresh.ts` + `src/lib/server-state.ts` /
  `server-state-wiring.ts` (`docs/specs/live-refresh.md`). Event-driven off
  the existing Hermes WebSocket (`cron.changed` / `sessions.changed` /
  `platforms.changed`), plus refresh-on-reconnect and
  refresh-on-window-focus; a slow timer (5 min / 60 s) is a backstop only,
  never the primary mechanism.
- **Companion self-update check:** `electron/companion-update-core.cjs`
  (pure semver/verdict) + `electron/companion-update.cjs` (fetch/throttle,
  IPC `hermes:companion-update`) + `SupportUpdatePanel.tsx`. Removes the
  prior hardcoded "always up to date" placeholder; hermetic-first gating
  (QA sentinel → 24 h throttle → network) so the packaged/isolated E2E
  suite never depends on network availability.
- **Diagnostics:** `electron/diagnostics-core.cjs` /
  `electron/error-journal.cjs` — redacted error text, version/compat facts
  and an app-level error timeline added to the diagnostics bundle; fixed a
  redaction gap where doubled backslashes in JSON-serialized Windows paths
  bypassed username redaction.
- **Public site:** `site/` — static, zero-build Hebrew RTL marketing/info
  page (`docs/specs/pages-site.md`).

---

## [0.4.0-alpha.1] - unreleased (pre-CHANGELOG baseline)

Everything before this file existed. See `docs/ACCEPTANCE.md` for the
durable, source-controlled acceptance record and `git log` for history.

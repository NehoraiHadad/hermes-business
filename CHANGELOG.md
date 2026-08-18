# Changelog

כל השינויים המשמעותיים בתכל'ס מתועדים בקובץ זה. הפורמט מבוסס על
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) והגרסאות עוקבות אחר
[SemVer 2.0.0](https://semver.org/) עם תגי קדם־שחרור (`docs/specs/versioning.md`).

לכל גרסה שני תתי־סעיפים: **מה חדש (למשתמש)** בעברית — הסעיף שמועתק אל גוף
ה־GitHub Release ומוצג (מקוצר) באפליקציה עצמה — ו־**Technical** באנגלית, לצוות
הפיתוח.

---

## [0.4.0-alpha.11] - 2026-08-18

### מה חדש (למשתמש)

- **עדכון מוצלח כבר לא מדווח ככישלון.** עד עכשיו, אחרי כל עדכון תכל'ס הודיע
  שהעדכון נחת אבל בדיקות התקינות נכשלות — גם כשהכול עבד מצוין. הסיבה: הוא בדק
  את המערכת לפני שהיא הספיקה לעלות. עכשיו הוא ממתין.
- **עדכון תקין כבר לא מבוטל מעצמו.** אותה בדיקה מוקדמת מדי יכלה לגרום למערכת
  לבטל עדכון מוצלח של Hermes ולחזור לגרסה הקודמת, ולהודיע שהעדכון נכשל.
- **חזרה לגרסה קודמת מוודאת את הגרסה הנכונה.** כשמבטלים עדכון, המערכת מוודאת
  שמה שרץ בפועל הוא באמת הגרסה שחזרנו אליה — ולא זו שביטלנו.
- **כפתורי ההורדה באתר מורידים את הקובץ.** שניים מתוך שלושה הפנו לרשימת הגרסאות
  ב-GitHub במקום להוריד. עכשיו כולם מורידים — גם כשאין אינטרנט ל-GitHub וגם עם
  JavaScript מכובה.
- **הודעה ברורה כשאין חיבור.** אם GitHub חוסם זמנית בגלל יותר מדי בקשות,
  ההתקנה אומרת את זה ומתי אפשר לנסות שוב, במקום שגיאה סתומה.

### Technical

**Three instances of one race, all measured live, not inferred.**
`ensureGatewayBackground()` returns when the gateway PROCESS is up, not when it
is ready; the gateway needs ~15-16 s to reach `state='running'` (Telegram alone
10.7 s including DNS-over-HTTPS fallback). Every health gate sampled once,
immediately, and missed by 4.9-6.1 s on consecutive real runs.

- `companion-apply.cjs` (120 s): every successful update reported
  `applied-unhealthy`. Journal never cleared, so the consumed 104 MB installer
  was never deleted, and no `applied` history entry was ever written — meaning
  the rollback feature's history anchor could never materialise in practice.
- `hermes-update-recovery.cjs` (180 s): DESTRUCTIVE — spurious `git reset` of a
  healthy agent update. Samples earliest of the three.
- `update-runtime.cjs` (180 s): worst odds — `stopOfficialSurfaces` has just run,
  so a fresh gateway is CERTAIN to be settling.

Fix is a bounded, advisory wait on the read-only deep probe, then the unchanged
single `fullHealth`. NOT a retry of `fullHealth`, which calls
`ensureGatewayBackground` and would restart the gateway being waited for.
Bounded twice (elapsed deadline + clock-independent attempt cap). Shared helper
in `hermes-health.cjs`, which both callers already depend on — no new dependency
edge, none inverted.

**Rollback verified against reverted code.** `rollbackAfterFailedUpdate` only
`git reset`s; it stops nothing, so `ensureGatewayBackground` and `startHermes`
were no-ops and the health proof covered processes still running the removed
code. Sharpest case: the version re-gate reverted, re-verified against the
still-running unsupported version, and reported the system restored and working.
Now `stopOfficialSurfaces` runs before the post-rollback recovery, and
`officialGatewayState()` must positively report `stopped` (`unknown` fails
closed) because that helper swallows a failed `gateway stop --all` by design.

**GitHub rate limits.** The primary unauthenticated limit is a **403**, absent
from `RetryableHttpStatus`, and no header was ever inspected. Now three distinct
cases: bare 403 (not retryable), primary limit (fail fast, naming the local reset
time), `Retry-After` (retried on the server's clock, clamped at 30 s).

**The CI external gate was non-functional.** `$ErrorActionPreference = 'Stop'`
plus `2>&1` on a native command raises a terminating `NativeCommandError` AT the
redirect, so the exit-code check never ran and the catch saw only the first
console-WRAPPED stderr line — the distinguishing keyword sat in the next
fragment. New `scripts/lib/external-gate.ps1` drives `System.Diagnostics.Process`
with async stream draining, and the swallow boundary is now structural
(`EXTERNAL-GATE-CONDITION:` marker) rather than regex-dependent, so widening the
classifier's input cannot widen what it swallows.

**One reader for the running app version** (`electron/app-version.cjs`). Three
had drifted; two threw, one returned null. Null compares as "cannot order"
everywhere downstream. Two mutation-tested guards in module-hygiene.

**`scripts/verify-published-release.mjs`** checks a published release against
docs/RELEASING.md step 9, with the expectations PARSED OUT OF that document so no
second copy can drift. Written because alpha.10 was published with a Hebrew
title, `checksums.json` instead of `SHA256SUMS.txt`, and a Hebrew-only body, and
nothing caught it.

**GitHub's release feed order is unspecified** — alpha.10 came back third,
despite being newest by created_at, published_at and id, and it is not lexical
either. `releases[0]` would offer alpha.9 while alpha.10 exists. Pinned by a
mutation-tested guard.

**Site**: all three download buttons now carry the direct asset URL statically,
so a click downloads the installer with JS disabled, offline or rate-limited;
previously only one of three was upgraded and the fallback was a release list.
Pinned to the newest `release-ledger.json` entry, so forgetting the site on a
release fails CI.

**Also**: `docs/RELEASING.md` gained three ordering traps that each cost a failed
run (commit the bump BEFORE packaging; `release/` is never cleaned; the
thin-installer capture command does not emit clean JSON), and
`scripts/e2e-companion-update.mjs` no longer writes into the operator's live
profile.

2502 -> 2680 tests.

---

## [0.4.0-alpha.10] - 2026-08-18

### מה חדש (למשתמש)

- **אפשר לחזור לגרסה הקודמת.** אם עדכון גרם למשהו להפסיק לעבוד, יש עכשיו כפתור
  במסך התמיכה שמחזיר את תכל'ס לגרסה שהייתה כאן לפני העדכון האחרון. ההגדרות
  והנתונים נשארים במקומם. הכפתור מופיע רק כשבאמת יש לאן לחזור.

### Technical

- **Reserve update-signing key** (`tachles-update-ed25519-c6379a37ef1fb417`)
  ships alongside the primary in `electron/update-trust.cjs`. Rotation only ever
  reaches FUTURE installs — a shipped build trusts exactly the ids compiled into
  it and there is no channel to add one — so a key generated after release is
  worthless to existing installs. Provisioning the spare before there is a user
  base is the only cheap moment. Protects against LOSS unconditionally; against
  COMPROMISE only while the two private halves live apart. No revocation channel
  exists, and `docs/specs/versioning.md` §7.4 states that rather than implying
  otherwise.
- **One-step rollback** (§7.5). `direction: 'forward' | 'rollback'` on
  `verifyUpdateManifest` inverts ONLY the ordering rule; the signature check and
  the `expectedVersion` anti-replay equality are untouched. What makes that safe
  is that the rollback's expected version comes from our own durable journal —
  the version this install recorded updating away from — not from the release
  feed, so the destination is a fact about the machine's past. New pure core
  (`companion-rollback-core.cjs`) + orchestrator (`companion-rollback.cjs`);
  the download engine, verifier, journal, launch-time reconciliation and NSIS
  argv are all reused unchanged. Confirmed against app-builder-lib's NSIS
  templates that they contain no downgrade guard.
- An ACTIVE `applying` record is archived as `applied-unhealthy` BEFORE a
  rollback download begins. Without that, `beginCompanionUpdate` would clobber
  the only evidence a previous version ran here, and a failed rollback would
  clear the journal as `failed` — permanently removing the way back, on a
  version that is already broken.
- `handleState` now projects a `direction`, computed in main by the one SemVer
  implementation, so the install button can never say "update" while the journal
  is about to install something older.
- **Fixed:** `scripts/e2e-companion-update.mjs` wrote into the LIVE profile.
  `clearCompanionJournal` takes `file` and `history` as separate options and
  defaults `history` to the real `%LOCALAPPDATA%\hermes` home; the harness
  redirected only `file`, so every rehearsal appended synthetic outcomes to the
  user's real update history.
- **Fixed:** the same harness hardcoded alpha.7/alpha.8 and had gone stale to
  the point of refusing to run. Versions are now discovered from whatever
  installer `release/` holds.
- 44 new tests; the offline rehearsal is now 20 assertions across 8 scenarios,
  including a rollback ACCEPTED and the same signed document REFUSED going
  forward.

---

## [0.4.0-alpha.9] - 2026-08-18

### מה חדש (למשתמש)

- **הגרסה הראשונה שמתעדכנת מעצמה.** alpha.8 הביאה את מנגנון העדכון; זו הגרסה
  הראשונה שאפשר להתקין דרכו בלחיצה אחת, בלי להוריד כלום מהדפדפן. אם יש לכם
  alpha.8 — תראו הצעה לעדכן בתוך האפליקציה.

### Technical

- Repo hygiene: `docs/evidence/forensics/` is now gitignored. It was untracked
  but not ignored, so it resurfaced as noise and was swept into a release commit
  by an over-broad `git add -A` (caught and reverted before it reached master).
- No runtime code changes. This release exists to exercise the alpha.8 →
  alpha.9 one-click update path end to end against real published assets.

---

## [0.4.0-alpha.8] - 2026-08-18

### מה חדש (למשתמש)

- **עדכון בלחיצה אחת.** עד היום, גרסה חדשה של תכל'ס דרשה הורדה ידנית מהדפדפן
  והתקנה עצמאית. מעכשיו האפליקציה מורידה את העדכון בעצמה, מוודאת שהוא באמת
  הגיע מאיתנו ולא נפגם בדרך, ומתקינה — ואז עולה מחדש. הכול בלחיצה, בלי דפדפן.
- **אתם מחליטים מתי.** שום דבר לא מתעדכן מאחורי הגב: לחיצה אחת מורידה ובודקת,
  ורק לחיצה שנייה מתקינה — עם הסבר מראש מה עומד לקרות וכמה זמן זה ייקח. עדכון
  שהורד ומחכה לא יתקין את עצמו, גם לא בהפעלה הבאה.
- **התראה שבאמת מגיעה.** עד היום, מי שמשאיר את תכל'ס פתוח ברקע לאורך זמן כמעט
  לא קיבל הודעה על גרסה חדשה — הבדיקה רצה רק ברגע ההפעלה. עכשיו הבדיקה חוזרת
  מעצמה, וגם כשחוזרים לחלון אחרי כמה ימים.
- **פחות "לא ידוע" מיותר.** מסך התמיכה הציג לפעמים "לא ניתן לבדוק עדכונים"
  גם כשהבדיקה עברה בהצלחה והכול היה מעודכן. עכשיו הוא אומר "מעודכן" כשזה מה
  שקרה — ושומר את "לא ידוע" למקרים שבהם באמת לא הצלחנו לבדוק.

### Technical

- **Certless runtime trust anchor.** Authenticode is unavailable, so each release
  now ships `update-manifest.json` — an Ed25519-signed statement over the
  installer's SHA-256 — staged atomically with the other sidecars. The public key
  ships in `electron/update-trust.cjs`; the private half lives outside the repo.
  `build/trust-roots.json` could not serve this role: it is retrospective and can
  only pin versions that already shipped.
- **Two-step verification, order-dependent.** The signed manifest is authenticated
  first (signature + expected-version match, blocking replay/downgrade of a
  genuinely-signed older manifest), and only then are the streamed bytes hashed
  against it. A ~104 MB installer is hashed chunk by chunk, written to a temp path,
  fsynced, and renamed into place only after the digest verifies.
- **Silent apply, journal-reconciled.** `/S --updated --force-run /currentuser`;
  all four flags load-bearing (`--updated` alone preserves the Hebrew shortcuts and
  suppresses the app-running dialog, `--force-run` is the only silent-relaunch path
  for an assisted installer, `/currentuser` avoids a UAC prompt for per-machine
  installs). The installer kills its own parent, so the outcome is unobservable in
  process and is instead reconciled at the next launch against the durable journal,
  gated on both foreground and gateway deep health.
- **No renderer input on either action.** The download and apply IPC handlers take
  no arguments; every operand is derived in main from the verdict and the journal.
- **Check-surface fixes.** The passive check was a one-shot `setTimeout` on a
  tray-resident app (one check per launch, forever); it now re-arms and also fires
  on return from the tray. `decideVerdict` distinguishes a complete non-empty
  census (`up-to-date`) from a truncated, undecidable or empty one (`unknown`).
- **Guards repaired.** `preload.test.ts`'s "every bridged method" check excluded
  subscribers by a hardcoded list; `hermes-bridge.ts`'s exhaustiveness guard was
  unconditionally `never` and caught nothing. Both now fail as intended.

---

## [0.4.0-alpha.7] - 2026-08-17

### מה חדש (למשתמש)

- **תיקון חשוב לעברית בהתקנה.** בהתקנות קודמות שני כישורי הקהילה נכתבו בקידוד
  שגוי והעברית בהם הפכה לג'יבריש — מה שמנע מהעוזר לזהות מתי להשתמש בהם. הבעיה
  תוקנה מהשורש: כל קובץ שההתקנה כותבת נכתב עכשיו בקידוד נכון, ובדיקה אוטומטית
  שומרת שזה לא יחזור.
- **עותק אחד לכל כישור.** הקמת קהילה אחרי התקנה השאירה בעבר שני עותקים של אותם
  כישורים (אחד תקין ואחד פגום). מעכשיו יש מקום אחד ועותק אחד, וההתקנה מנקה
  שאריות ישנות בשדרוג.
- **בדיקות התקנה מקיפות יותר.** מסלול ההתקנה הנקייה נבדק עכשיו עם כל רכיבי
  ההתקנה האמיתיים, כך שחוסר עקביות בין דרכי ההתקנה נתפס לפני שהוא מגיע אליכם.

### Technical

- **PS 5.1 encoding root cause fixed (W1):** both install doors run Windows
  PowerShell 5.1, whose `Get-Content -Raw` default (Windows-1252) mangled the
  UTF-8-no-BOM community skill templates during placeholder rendering — the
  installed Hebrew was mojibake AND the inflated descriptions (82/77 chars)
  blew the 60-char routing budget, so the skills never routed. New
  framework-direct `Read-Utf8File`/`Write-Utf8File` in `FileOps.ps1`; full
  encoding sweep of `installer/lib` (template render, SDK read, rollback +
  completion receipts previously written WITH a BOM under PS 5.1,
  manifest reads). New 7-test `business-install.tests.ps1` suite runs under
  real PS 5.1 with a mojibake canary (122/122 lib assertions).
- **One canonical community-skill path (W2):** the installer now renders
  `community-bootstrap`/`community-admin` to the generator-owned canonical
  `skills/<name>/SKILL.md` with exact byte-parity to `renderAdminSkill`
  (LF-normalized, same placeholder set), and prunes the legacy
  `skills/community/<name>/` copies on upgrade. Parity proven in production:
  contract apply reports the door-rendered skills `unchanged`.
- **Payload manifest as single source of truth (W3):**
  `scripts/payload-manifest.mjs` + a 33-test contract
  (`payload-manifest-contract.test.ts`) statically parse all four install
  doors (NSIS / Electron / BusinessInstall / clean-install E2E) and fail on
  any drift; section-internal file lists stay single-sourced in
  `electron/paths.cjs` / `plugin-install.cjs`.
- **Clean-install E2E repaired:** `e2e-bootstrap-clean.ps1` now stages the
  full payload (`tachles-welcome`, `business-partner`), asserts their
  installed files + receipt hashes, and derives the version assertion from
  `hermes-compat.json` instead of a hard-coded `0.19.x` regex.

## [0.4.0-alpha.6] - 2026-08-17

### מה חדש (למשתמש)

- **שיחת פתיחה שמבינה אתכם.** בהפעלה הראשונה העוזר פותח בשיחה קצרה כדי להבין
  מה הייעוד — ניהול עסק, ליווי קהילה או שילוב — ומכוון את ההקמה בהתאם. שאלה
  אחת בכל פעם, בלי טפסים.
- **יכולת הקהילה מגיעה מוכנה בהתקנה.** מי שצריך ניהול קהילת וואטסאפ מקבל את
  כל הכלים כבר מההתקנה הרגילה — אותה הורדה אחת לכולם, והעוזר פותח את מה
  שצריך לפי הצורך.
- **התקנה אמינה יותר.** מסלול ההתקנה אוחד כך שכל דרכי ההתקנה עוברות את אותה
  בדיקת שלמות מלאה.
- **חיבור וואטסאפ עמיד יותר לתקלות רשת.** עדכון מנוע: החיבור ממשיך לעבוד גם
  כשגורם חיצוני (כמו תקלה אצל ספק שירות) אינו זמין זמנית.

### Technical

- **Role-aware first conversation (74762a0, 8d23da5):** new routable
  `tachles-welcome` skill (role sensing: business / community / both) dispatched
  by onboarding instead of `business-bootstrap` directly; shipped through all
  four install doors with a four-door drift test; the plugin fallback
  questionnaire deliberately keeps `business-bootstrap` (role already known
  there).
- **Community runtime fingerprinted (ee7803b):** shipped community sources
  (generator + provision CLIs, `scripts/lib/community`, community skills) added
  to `PACKAGED_INPUTS` + `THIN_INSTALLER_INPUTS` as `COMMUNITY_RUNTIME`,
  contract-anchored to `build.extraResources`.
- **Single install door (bcc580c):** `electron/business-install.cjs` runs the
  same bootstrap transaction (`bootstrap.ps1` with detection of an existing
  engine) for both fresh and existing-Hermes installs; the JS-side branch is
  gone.
- **Community engine pin → v0.3.1 (f44d02d5):** WhatsApp bridge survives
  version-endpoint outages via an on-disk `wa-version-cache.json`
  (fetch → memory → disk → library-default tiers); upstreamed as
  NousResearch/hermes-agent PR #88466.

## [0.4.0-alpha.5] - 2026-08-17

### מה חדש (למשתמש)

- **שיחה יציבה יותר.** חלון האישור ("לאשר פעולה?") נענה פעם אחת בדיוק — בלי
  כפילויות; תיבת הכתיבה נשארת זמינה גם בזמן שהעוזר עובד; והחיווי "העוזר
  סיים" מופיע רק כשהתשובה באמת הסתיימה.
- **מסך הבית מציג את העסק האמיתי.** במקום הודעת פתיחה כללית, המסך הריק
  משקף את המצב בפועל — מה מחובר, מה מוגדר ומה כדאי לעשות עכשיו.
- **קריא ונגיש יותר.** ניגודיות הטקסט הועלתה לתקן נגישות (AA), נקבע גודל
  טקסט מינימלי, וסרגל הצד נגלל כמו שצריך גם בזום גבוה.
- **שעה בפורמט 24 שעות — תמיד.** שדה השעה בתזמונים כבר לא מושפע מהגדרות
  האזור של המחשב.
- **דיוק במסכים.** כל שיחה בסרגל הצד מציגה את הזמן האמיתי שלה; מסך החיבורים
  כבר לא מציג כפתור "ניתוק" שלא באמת ניתק; וכותרת מסך המשימות תואמת את מה
  שרואים בו.
- **מצב ההדגמה משתפר.** התשובות בהדגמה מתייחסות למה שנשאל בפועל, במקום
  תשובה קבועה אחת.

### Technical

- **Product-design audit P0/P1 fixes (merge c4ab0eb):** approval gate answered
  exactly once (37a2420), composer usability + turn-state announcement
  (a99eae3, 7ee33a0), grounded home empty state (719bf27), AA contrast +
  type-size floor (3770972), sidebar scroll under zoom (a8634d3), locale-proof
  24h time field (43d22ff), real per-conversation timestamps (b7dc167),
  removed the no-op disconnect affordance (4e7c5ae), tasks heading + native
  confirm removal (52d5301), demo transport answers the actual question
  (9ad407a).
- **WhatsApp egress gate: contract-authorized community sources (f7e59c6):**
  `business-whatsapp-policy` now honors a generator-owned `community_sources`
  list in `business/whatsapp-policy.json` — community-contract groups and
  admin DMs are authorized regardless of owner mode; the owner surface is
  preserved verbatim; an unparseable policy file is refused (fail-closed).
  Unrelated installs (no `community_sources` key) behave exactly as before.
- **Community capability (983886c, 506c378, dba25b3):** the repo now carries a
  community mode — contract-driven provisioning (`community.yaml` →
  profiles/skills/egress grants) and a scoped `community-archive` read-only
  plugin. The plugin ships in the installer payload (under `hermes-plugin/`)
  but is inert unless a community contract provisions it; the desktop product
  behavior is unchanged.

---

## [0.4.0-alpha.4] - 2026-08-04

### מה חדש (למשתמש)

- **העוזר באמת מקבל את ההנחיות שלו.** התברר שההנחיה המרכזית שמגדירה איך
  העוזר עובד כשותף עסקי כמעט לא נטענה בפועל — הכותרת שלה הייתה ארוכה מדי
  והמערכת קיצצה אותה. עכשיו היא קצרה וברורה, וההנחיות המלאות (כולל הכלל
  שאסור לשלוח, להוציא כסף או למחוק בלי אישור מפורש) מגיעות לעוזר כמו שצריך.
- **סנכרון הגנת הוואטסאפ.** רכיב ההגנה על הוואטסאפ מתעדכן לגרסה האחרונה,
  ונוספה בדיקה שמוכיחה אותו מקצה לקצה: בדקנו מול המנגנון האמיתי שהעוזר
  אינו יכול לשלוח הודעה בוואטסאפ כשהמצב הוא "קריאה בלבד", שגם משימה
  מתוזמנת ברקע אינה יכולה, ושכששיחה מאושרת במפורש — השליחה כן עוברת.

### Technical

- **Skill routing budget (docs/specs/provider-costs.md audit follow-up):**
  Hermes truncates a skill's frontmatter `description` to 60 chars when
  building the model's per-turn skill index (`agent/skill_utils.py`,
  `SKILL_PROMPT_DESC_LIMIT`). `business-partner` shipped a 235-char
  description and measured ZERO loads ever in the live session DB (vs 18 for
  business-bootstrap, 17 for business-context). Both shipped descriptions are
  now trigger-first and within budget; `scripts/lib/skill-routing-budget.test.mjs`
  scans every shipped SKILL.md and fails on an over-budget/missing description.
  The run-on `provider_state semantics:` prompt line was split into short
  sentences and the bundled plugin rebuilt.
- **Live egress proof (`tests/test_live_egress_proof.py`):** drives the REAL
  installed WhatsApp adapter through this plugin's real guard machinery across
  all three outbound doors (`adapter.send`, standalone/cron sender,
  `_send_to_platform`) under four policies, with the final network hop replaced
  by a tripwire — so "blocked" proves transport was never handed the message.
  13/13 against both the installed plugin and this repo's version; Telegram
  (delegated entirely to native Hermes since 88fb302) passes through untouched.
  Context: native Hermes 0.19.1 gates INBOUND (dm_policy/pairing) but has no
  outbound gate — none of its four send paths consult `_is_user_authorized`.

---

## [0.4.0-alpha.3] - 2026-08-04

### מה חדש (למשתמש)

- **כמה זה עולה — עכשיו רואים.** במסך העזרה, תחת "מצב המערכת", נוספה שורת
  "שימוש ב־AI": כשהעוזר מחובר דרך חשבון ChatGPT היא מציגה כמה אחוזים
  מהמכסה כבר נוצלו; אם ספק הבינה המלאכותית הודיע שהמכסה נגמרה, מופיעה הודעה
  ברורה — "המכסה נוצלה כרגע, תתחדש אוטומטית"; ובשאר המקרים מוצג כמה פניות
  נעשו היום ובחודש האחרון. השורה מידעית בלבד — היא לעולם לא חוסמת שום פעולה.
- **כל ספקי ה־AI שנתמכים — ברשימה אחת.** מסך חיבור הספק מציג עכשיו את
  הרשימה המלאה מתוך Hermes עצמו, כולל ספקים שמתחברים עם חשבון (בלי מפתח):
  ChatGPT‏, Nous Portal (חשבון חינם להתחלה), MiniMax‏, xAI Grok — וגם ספקים
  שמנוהלים בכלי חיצוני, עם הסבר קצר איך. ספק חדש שיתווסף ל־Hermes יופיע
  מעצמו.
- **מסלול חינמי להתחלה.** אפשר להתחבר עם חשבון Nous חינמי ולקבל גישה
  למודלים חינמיים — האפליקציה בוחרת מודל מתאים אוטומטית.
- **עמוד "כמה זה עולה" באתר.** אתר המידע כולל עכשיו פירוט הוגן של העלויות:
  תכל'ס עצמו חינם, המסלול המומלץ (מנוי ChatGPT), האפשרויות החינמיות, ומה
  כדאי לדעת על זרימת המידע לספק שבחרתם.

### Technical

- **Dynamic provider catalog (docs/specs/provider-costs.md):** the provider
  modal renders `GET /api/providers/oauth` mapped by `flow` onto exactly three
  UI shapes — the generalized device-code flow (`DeviceFlowOAuth`, extracted
  from the Codex component; fresh-approval-only evidence for non-Codex
  providers), the existing paste-a-key form, and a display-only external-CLI
  card (also the fail-safe for unknown flows). Failed catalog read falls back
  to the static pre-catalog list (`src/lib/provider-catalog.ts`).
  `activateProvider` now passes through Hermes' `free_tier` verdict.
- **Usage & quota row (`src/lib/health-panel.ts` usageRow):** local
  cross-provider accounting from `GET /api/analytics/usage` (days=30/1),
  layered under a quota tier resolved in `src/lib/provider-quota.ts`:
  Hermes' credential-pool `exhausted` verdict (`GET /api/credentials/pool`,
  new allow-listed read-only route) outranks the live Codex `used_percent`
  (codex-probe extended with display-only `usedPercent`/`quotaExhausted`
  fields — `gateExistingCodexGrant` unchanged, contract-tested), which
  outranks the local counts. Display-only by construction: the row can only
  be `ok`/`warning`, never `error`, and never affects the overall verdict.
- **IPC guard:** two new allow-listed routes (`/api/analytics/usage` +
  `days` query key, `/api/credentials/pool` list-only; per-entry mutation
  routes stay blocked), lockstep-tested.

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

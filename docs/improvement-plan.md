# תוכנית שיפור — תכל'ס (2026-08-03)

מקור: סקירת ארכיטקטורה מלאה בארבע שכבות (Electron main, React, scripts/release,
plugins+shared). העיקרון: הליבות הטהורות מצוינות; החולשה השיטתית היא ב"קילומטר
האחרון" — שגיאות שלא מגיעות למשתמש, רשימות מסונכרנות ביד, וכלים שמשכפלים לוגיקת
מוצר. הסדר: רשתות ביטחון → אמינות → facade → dedup → ניקיון.

**מחוץ לתוכנית:** רגרסיית מצב ה-QA המבודד (`runtime-mode.cjs` מייבא resolver
לא-ממומואיזם ⇒ בדיקת empty-home רצה מחדש אחרי ש-`main.cjs:45` יצר
`electron-user-data` ⇒ `QaOverrideError` בכל קריאה עוקבת) — מטופלת בסשן נפרד
(task_e3941eb9). עד למיזוגה לא נוגעים ב-`runtime-mode.cjs`, `qa-runtime.cjs`,
`main.cjs`.

כללי ביצוע: כל משימה = סוכן אחד עם בעלות בלעדית על קבציו; שער `npm test`
(+`verify:plugin` כשנוגעים במקור הפלאגין) בסוף כל שלב; בלי commits אלא אם התבקשו.

## שלב 1 — רשתות ביטחון

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 1.1 | בדיקות lockstep לרשימות ההתקנה: reverse-check `readdir ⊆ allow-list` לפלאגין המדיניות (`electron/paths.cjs:64`) ול-backend הנלווה; כיסוי `scripts/e2e-bootstrap-clean.ps1` + `e2e-companion-bootstrap.ps1` (לא מאומתים); תיקון substring false-positive בבדיקת ה-NSI (`contract.py` ⊂ `tool_contract.py`) | Sonnet | ✅ הושלם |
| 1.2 | חיווט 7 בדיקות האבטחה של `hermes-plugin/business-shell/dashboard/test_plugin_api.py` ל-`test:plugin:policy`/`test:contract`/`verify:release` (כיום לא רצות באף סקריפט) | Sonnet | ✅ הושלם |
| 1.3 | בדיקת parity ל-`shared/`: כל export ב-`.js` ⇔ `.d.ts`; תיקון דריפט קיים — `compatible` חסר ב-`onboarding-bootstrap.d.ts:13`; טיפוסי snapshot מוצהרים במקום `Record<string, unknown>` | Sonnet | ✅ הושלם |
| 1.4 | בדיקות lockstep לקבועים כפולים: QA sentinel (3 עותקים), טווח פורטים 41000–60000 (2), regex נתיבי E2E (2), טווח תאימות Hermes (4 מקומות) | Sonnet | ✅ הושלם |

תוספת תוך-כדי: `vite.config.ts` — החרגת `**/.claude/**` (worktrees של סשנים
מקבילים) מסריקת vitest; שער שלב 1 ירוק (152 קבצים, 1194 בדיקות).

## שלב 2 — אמינות ליבה

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 2.1 | WS reconnect + backoff ב-`transport.ts` (אין `close` listener; ניתוק = צ'אט מת לצמיתות); דחיית in-flight על close; `onRestart` ממתין לחיבור מאומת לפני toast | Opus | ✅ הושלם |
| 2.2 | נורמליזציית שגיאות IPC בגבול (העברית מ-main לא שורדת את עטיפת Electron); איחוד redaction על `redact.cjs` ומחיקת `security.cjs` (החלש שומר על הלוג החי); סריאליזציית `hermes:install` | Opus | ✅ הושלם |
| 2.3 | כנות תצוגה: `loadErrors` ל-`TasksScreen`/`ConnectionsScreen` (כשל קריאה מוצג כ"0 משימות"); רינדור `useAsync().error` ב-4 מסכי הפלאגין; תיקון `onToggle` הבולע + חתימות `=> Promise<void>` | Sonnet | ✅ הושלם |

הערות שלב 2: (א) חידוש זרם אירועי צ'אט אחרי reconnect דורש `session.resume` —
מועבר לשלב 3 (חיווט ב-`useChat`). (ב) `getWhatsappGuardActivation` מחווט
ב-preload/ipc אך לא מוצהר ב-`vite-env.d.ts` ואין לו צרכן — לטפל בשלב 3/5.
(ג) `testTimeout: 15000` ב-vite.config — סוויטות spawn-כבדות תחת עומס מקבילי.

## שלב 3 — facade ו-demo

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 3.1 | ניתוב ~20 קריאות `window.hermesDesktop` ישירות דרך `HermesClient`; fixtures ל-demo; מחיקת ענפי `hermesClient.demo` מקומפוננטות (בראשן `WhatsappCloudConnect.tsx:35` שעוקף בדיקת בטיחות) | Opus | ✅ הושלם |

הערות שלב 3: chokepoint שלישי `src/lib/hermes/desktop.ts` (19 מתודות);
`useAssistantWindow` נשאר חריג מתועד (window plumbing); שער ה-onboarding
ב-`App.tsx` נשאר בכוונה (הוכחת בעלות מאומתת — demo לא מזייף ראיות);
`chat-resume.ts` seam טהור ל-`session.resume` אחרי reconnect; שער ירוק
(156 קבצים, 1254 בדיקות). שלב 4 אוחד ל-3 סוכנים (4.2+4.3 מוזגו — חפיפת קבצים).

## שלב 4 — איחוד כפילויות

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 4.1 | Electron dedup: 5 כתיבות temp+rename ידניות → `safeWrite`; 3 נורמליזציות WhatsApp principals → אחת; `isUnder` ×3 → `path-containment.cjs`; journal של guard-activation לחוזה של update-journal-store | Sonnet | ✅ הושלם |
| 4.2 | Scripts dedup: harness משותף `probe-app.mjs` ל-6 סקריפטי UI (כולל ניקוי temp-dir); `dev-desktop.mjs` מייבא קבועים; `parseChannel` אחד; `package-win.mjs` מאחד את שני הצינורות | Opus | ✅ הושלם (מוזג עם 4.3) |
| 4.3 | חיזוק שער ה-E2E: הרביעייה המלאה נדרשת (ולידטורים מיובאים מ-`qa-runtime-policy.cjs`); `live-restore-journal.mjs` עמיד-לקריסה עם profile scoping; החלה על `e2e-missing-hermes-ui` | Opus | ✅ הושלם |
| 4.4 | `shared/schedule-display` + `shared/tool-copy` בדפוס `cron-identity-contract`; חיבור שני ה-UI + בדיקות parity; בדיקת ה-parity הוסבה לגילוי אוטומטי מהדיסק | Sonnet | ✅ הושלם |

הערות שלב 4: (א) התגלה באג סמוי קיים-מראש ב-`isUnder` (גבול-מפריד no-op —
`/tmp-evil` נחשב תחת `/tmp`) — שומר על ההתנהגות, תועד בבדיקה, נפתח task נפרד.
(ב) `e2e-missing-hermes-ui` הוסב למצב runtime פיתוח (production מסרב ל-home
זמני — התנהגות נכונה). (ג) שער ירוק: 163 קבצים, 1409 בדיקות + `verify:plugin`.

## שלב 5 — ניקיון וליטוש

| # | משימה | מודל | סטטוס |
|---|---|---|---|
| 5.1 | קוד מת: שרשרת onboarding ישנה (443 שורות נמחקו), `qa-electron-namespace.cjs`, exports מתים, פרמטר `_services` מקצה-לקצה, 2 כפתורים ללא handler | Sonnet | ✅ הושלם |
| 5.2 | CSS: `styles/buttons.css` קנוני (מיובא שני); מחיקת מחלקות יתומות + `onboarding-approval.css` שלם; `onboarding-form.css` ‏137→14 שורות; logical properties (שני offsets של window-controls נשמרו פיזיים + הערה) | Sonnet | ✅ הושלם |
| 5.3 | נגישות + toast: Escape/focus-trap/restore ב-`Modal.tsx` (8 דיאלוגים); `role="alert"` ×14; toast עם id+severity לכל הודעה (שגיאות 6s, מרוץ טיימרים נסגר); הוסרה הדחקת ה-toast במסך התמיכה | Sonnet | ✅ הושלם |
| 5.4 | Python: authorizer של guards עטוף fail-closed (באג אמיתי); 3 הדלתות נשארו בכוונה (ניתוב דרך families היה משנה סמנטיקה — תועד); `make_outbound_guard` אחד; docs אמיתיים; renames מ-underscore; `__pycache__` נוקה | Sonnet | ✅ הושלם |
| 5.5 | PowerShell: `Set-StrictMode`+`#Requires` ב-bootstrap; פרמטרים מפורשים ב-`BusinessInstall.ps1`; דחיית PATH מנתיבי E2E; ניתוב דרך `SemVer.ps1` (כולל תיקון באג load-order של `-SkipCompanionInstall`); regex gateway מהודק בהתאם ל-CLI האמיתי | Sonnet | ✅ הושלם |
| 5.6 | `ErrorBoundary` עברי ב-`main.tsx`; README מסונכרן לשמות הסקריפטים החדשים; `.gitignore` + `.pytest_cache` | Sonnet | ✅ הושלם |

## שער סופי — ✅ עבר (2026-08-03)

- `npm test` מלא: 165 קבצים, 1,424 עוברות (כשל בודד ראשון היה timeout חולף תחת
  עומס; ריצה חוזרת נקייה).
- `verify:plugin`: bundle מסונכרן + חוזה SDK מול Hermes 0.19.1 מותקן.
- `test:plugin:policy`: ‏71+7 בדיקות פייתון (כולל ה-dashboard שחווט בשלב 1).
- `npm run build`: הצליח (אזהרת chunk>500kB אינפורמטיבית בלבד).
- `test:e2e:installed-isolated` ✅ **עבר** (הושלם אחרי מיזוג תיקון ה-QA,
  ‏commit ‏2a9eb2d): ‏`build:test-packaged` טרי (0.4.0-alpha.1, ‏head ‏d502166)
  ואז ריצה מבודדת מלאה — mode=qa-isolated, פורט מבודד, הפרופיל החי לא נגע
  (`live_marker_exact_equal:true`, רק churn נדיף מותר `{cron:1}`), teardown נקי.

## ממצאים שנפתחו כמשימות נפרדות תוך כדי

- רגרסיית מצב QA מבודד — ✅ תוקנה (סשן נפרד task_e3941eb9, ‏commit ‏2a9eb2d).
- באג סמוי ב-`isUnder` — גבול-מפריד no-op, `/tmp-evil` נחשב תחת `/tmp` —
  ✅ תוקן (סשן נפרד task_8e7e3608, ‏commit ‏d502166).

## המשך (2026-08-03, אחרי השער הסופי)

- ✅ הגבלת `hermes:api`: הערוץ היה proxy פתוח לכל ה-gateway עם ה-session token,
  ו-`hermesApi` אף העביר `init.headers` מה-renderer אל ה-fetch המאומת. נוספו
  `assertAllowedApiEndpoint` (allow-list אנכורי של כל מסלולי המוצר + הגנות
  traversal/קידוד + allow-list למפתחות query) ו-`sanitizeApiInit` (רק
  `{method, body}`; ‏headers לעולם לא מועברים) ב-`ipc-guards.cjs`, מחווטים
  ב-`ipc.cjs`. בדיקת lockstep סורקת את כל ליטרלי `/api/…` ב-`src/` כך ש-endpoint
  חדש ב-renderer שובר CI ולא נכשל בזמן ריצה.
- ✅ עותק ה-`isUnder` השלישי ב-`runtime-mode.cjs` אוחד על `path-containment.cjs`
  (עטיפת resolve-first); נותרה מימוש containment יחיד ב-main.
- ✅ דיוק אבחון (2026-08-03): חבילת האבחון נושאת עכשיו את **טקסט** שגיאת
  ה-runtime (redacted, לא רק boolean), יומן שגיאות-אפליקציה מובנה
  (`error-journal.cjs` — ring redacted-at-ingestion, מוזן אוטומטית מכל
  `patchRuntimeState({error})` ומ-`uncaughtExceptionMonitor`/`unhandledRejection`),
  מצב guard חי + שלב activation, מצב journal של עדכון (נוכחות/שלב/מונה כשלים),
  מצב partner (enums), ‏uptime וגרסת/תאימות runtime. הכול הקרנת allow-list
  קשיחה — לוגים גולמיים נשארים בחוץ בכוונה (עלולים לשאת תוכן שיחות).

## רשימת המשך-דרך (roadmap, לפי ערך למוצר)

1. **נראוּת השותף** — ✅ **מומש** (2026-08-04, `docs/specs/partner-feed.md`,
   שלבים 1–5). פיד "מה השותף עשה בשבילך" — check-ins שרצו, ‏insights של
   ה-curator, ‏sessions שנוצרו ברקע מ-cron/ערוצים — בראש מסך "פעילות ומשימות":
   `electron/partner-feed.cjs` (אגרגציה מוקרנת ב-main), `src/lib/partner-feed.ts`
   (גזירה טהורה), `src/hooks/usePartnerFeed.ts` + `src/components/screens/
   PartnerFeedPanel.tsx` (UI, כל מצבי ה-fail-closed מסעיף 6.3), CTA "פתח את
   השיחה" מחווט עד `chat.selectSession` (`App.tsx`→`FullAppShell`→`MainScreen`→
   `TasksScreen`), ‏badge "פעילות חדשה" בניווט. זה מה שהופך "סוכן על המכונה"
   ל"שותף לעסק" בעיני בעל העסק. (בקשת המשתמש, 2026-08-03.)
2. **מודל רענון server-state** — ✅ **מומש** (`docs/specs/live-refresh.md`):
   מונע-אירועים דרך `hermesClient.onEvent` הקיים (`src/lib/server-state.ts` +
   `src/lib/server-state-wiring.ts`; refetch על אירועי session/cron, על
   reconnect ועל focus; ‏polling עדין רק כ-fallback). `usePartnerFeed` נרשם
   ל-`useServerState('partner')` וממש נצרך על ידו — סעיף 1 חי בפועל, לא רק
   מתוכנן.
3. **תשתית בדיקות קומפוננטות** — ‏vitest + ‏jsdom ל-`*.test.tsx` + ‏Testing
   Library; להתחיל מ-Modal (focus-trap), ‏toasts, שער ה-onboarding, ‏ErrorBoundary.
4. **שערי הפצה** (כשמפיצים בפועל): ‏code signing (SmartScreen מופעל רק על קבצים
   שהורדו — לכן מקומית לא רואים אזהרה), ‏manifest ב-GitHub Releases (כתובות
   קבועות, חינם, immutable), ‏Google OAuth — ‏per-עסק credentials זו הארכיטקטורה
   הנכונה ל-local-first; ‏verification נדרש רק לאפליקציה מרכזית מרובת-עסקים.
5. ‏telegram evidence — ‏round-trip חי (דורש אישור משתמש — שולח הודעות אמיתיות).

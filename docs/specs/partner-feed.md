# אפיון: פיד "נראוּת השותף" (Partner Visibility Feed)

**מסמך:** `docs/specs/partner-feed.md` · **תאריך:** 2026-08-03 · **יעד:** Hermes 0.19.1 (טווח נתמך `>=0.19.0 <0.20.0`, ר' `hermes-compat.json`) · **מקור דרישה:** `docs/improvement-plan.md` — "רשימת המשך-דרך" סעיף 1 ("נראוּת השותף"), שורות 116–123.

---

## 1. רקע ומטרות

תכל'ס מציג היום את Hermes כ"כלי שמחכה לי": צ'אט, רשימת משימות מתוזמנות, חיבורים. אבל השותף עובד גם כשהחלון סגור — check-ins מתוזמנים רצים, שיחות נכנסות מטלגרם/WhatsApp נענות, ה-curator לומד ומתחזק כישורים. שום דבר מזה לא נראה. הפיד עונה על השאלה **"מה השותף עשה בשבילי כשלא הסתכלתי?"** — והופך את התחושה מ"כלי" ל"שותף שעבד".

### מטרות
1. פיד כרונולוגי במסך "פעילות ומשימות" (ה-home של הפעילות; `NAV_ITEMS` ב-`src/constants.ts:17-21`) שמציג: ריצות של משימות מתוזמנות (כולל ה-check-in של מצב שותף), sessions שנוצרו ברקע מערוצי הודעות, ותובנות curator.
2. כל פריט מגובה בראיה מ-Hermes עצמו — אף פעם לא מפוברק. `null`/כשל קריאה מוצג כ"לא ידוע", לא כ"אין פעילות" (דוקטרינת fail-closed, כמו `LoadErrors` ב-`src/lib/health.ts:26`).
3. לחיצה על ריצת cron או session רקע פותחת את השיחה עצמה בצ'אט ("מה יצא מזה" — התמליל האמיתי, לא סיכום מסונתז).
4. שימוש בדלתות הרשמיות של Hermes בלבד; אפס לוגיקת scheduler/‏store מקבילה.

### לא-מטרות
- **לא** מתכננים כאן את מנגנון הרענון מונע-האירועים — זה ה-spec האחי (roadmap סעיף 2). אנחנו מגדירים רק את הממשק שאנו מניחים (סעיף 7).
- **לא** התראות push/toast על פריט חדש (שלב עתידי).
- **לא** בדיקות קומפוננטות jsdom (roadmap סעיף 3) — מפורט מה יידחה לשם.
- **לא** סיכומי-תוכן מסונתזים של ריצות (LLM-summary). ה-CTA הוא פתיחת התמליל.
- **לא** כתיבה כלשהי ל-Hermes. הפיד הוא read-only טהור.
- **לא** מסך ניווט חדש — הפיד משתלב במסך הקיים.

---

## 2. מקורות הנתונים ב-Hermes 0.19.1 — ראיות

כל הנתיבים אומתו מול ההתקנה בפועל: `%LOCALAPPDATA%\hermes\hermes-agent`.

### 2.1 ריצות של משימות מתוזמנות — קיים רשמית ✅

| דלת | ראיה (file:line בהתקנת hermes-agent) | מה מקבלים |
|---|---|---|
| `GET /api/cron/jobs?profile=default` | `hermes_cli/web_routers/cron.py:51` | כל ה-jobs; כל רשומה מנורמלת (`cron/jobs.py:440` `_normalize_job_record`) נושאת `id`, `name`, `enabled`, `schedule_display` (`cron/jobs.py:465`), `next_run_at`, **`last_run_at`**, **`last_status`** (`"ok"`/`"error"` — נכתב בסיום ריצה, `cron/jobs.py:1694-1706`; אתחול `None` ב-`cron/jobs.py:1419-1421`) |
| `GET /api/cron/jobs/{job_id}/runs?limit=N` | `hermes_cli/web_routers/cron.py:61-63` → `hermes_cli/web_server.py:11503` `_list_cron_job_runs_sync` | היסטוריית ריצות: ריצת cron היא **session רגיל** שה-id שלו `cron_{job_id}_{timestamp}` (`cron/scheduler.py:3004`) ו-`source='cron'`. השאילתה היא סריקת-טווח על ה-id (`hermes_state_portability.py:70` `list_cron_job_runs`) ומחזירה שורות בפורמט `/api/sessions`: `id`, `title`, `preview`, `started_at`, `ended_at`, `last_active`, `message_count`, `is_active`, `archived` |

**מה לא קיים ואסור להמציא:** ledger הביצועים `cron/executions.db` (`cron/executions.py` — סטטוסים `claimed/running/completed/failed/unknown`) **אינו חשוף בשום route** — `grep executions` על `hermes_cli/web_server.py` + `web_routers/*` מחזיר כלום. לכן "האם הריצה הצליחה" נשען על `last_status` שברשומת ה-job (רזולוציית "ריצה אחרונה בלבד") + על קיום session הריצה. סטטוס פר-ריצה-היסטורית איננו זמין רשמית; אם יידרש בעתיד — הדלת הנכונה היא הרחבת ה-plugin הנלווה (סעיף 2.5), לא פרסינג של DB פנימי.

### 2.2 זיהוי ה-check-in של השותף — קיים בצד שלנו ✅

ה-check-in הוא cron job רגיל הנושא marker בשם: `hermes-business-partner-checkin` (`electron/partner-checkin-def.cjs:12` `MARKER`, פרדיקט `isOwnedCheckin`). הפיד מסמן פריטי ריצה של jobs כאלה כ-`kind: 'checkin-run'` ומציג אותם בניסוח "שיחת בדיקה תקופתית" — שאר ה-jobs מוצגים בשמם.

### 2.3 sessions שנוצרו ברקע (Telegram/WhatsApp/ערוצים) — קיים רשמית ✅

`GET /api/sessions?limit=N&order=recent` — `hermes_cli/web_routers/sessions.py:50-63`. פרמטרים רשמיים: `limit`, `offset`, `order=created|recent`, `archived`, `source`/`sources`/`exclude_sources` (הדוקסטרינג בשורות 104-107 מציין במפורש שה-desktop הרשמי משתמש בהם להפרדת recents מ-cron). כל שורה: `id`, `source`, `title`, `preview`, `started_at`, `ended_at`, `last_active`, `message_count`, `is_active`.

סיווג "רקע": `source` הוא שם הפלטפורמה (session tagging — `hermes_state.py:14`: `'cli'`, `'telegram'`, `'discord'`, …; ה-companion יוצר עם `source: 'desktop'` — `src/lib/hermes/session.ts:66`). מכיוון שרשימת הפלטפורמות דינמית (gateway/platforms), הסיווג הוא **deny-list של המשטחים-שלנו**: `source ∈ {desktop, cli, tui, web, tool, cron}` ⇒ לא-רקע (cron מוצג דרך 2.1; `tool` הם תת-סוכנים פנימיים — גם `session.list` הרשמי מסנן אותם, `tui_gateway/methods_session.py:162-176`). כל source אחר = פעילות רקע ומוצג עם תוויתו. זו החלטת **תצוגה** allow-by-default (ראיה שהשותף עבד), לא גבול אבטחה.

### 2.4 תובנות curator — קיים רשמית וכבר מחווט ✅

`GET /api/curator` (`hermes_cli/web_server.py:3405`) + `GET /api/learning/graph?profile=default` (`web_server.py:3444`). כבר קיים גשר main-process שלם: `electron/curator-insights.cjs` (ערוץ `hermes:curator:insights`, `electron/ipc.cjs:114`) ועיצוב-הודעות בעברית ב-`src/lib/hermes/curator.ts` (`deriveCuratorNotifications`). כיום נצרך רק ב-`SkillsScreen`. הפיד **צורך את אותו גשר קיים** — אפס דלת חדשה.

### 2.5 דלת ה-plugin הנלווה — קיימת כ-fallback, לא נדרשת כאן

`hermes-plugin/business-shell/dashboard/plugin_api.py` עולה תחת `/api/plugins/business-shell/` (`hermes_cli/web_server.py:16802-16917` `_mount_plugin_api_routes`) — התקדים של paused-listing. **הפיצ'ר הזה לא צריך אותה**: כל הנתונים זמינים מדלתות ליבה רשמיות. היא נשארת הדלת המיועדת אם בעתיד נרצה סטטוס פר-ריצה מ-executions.db (הקרנה read-only בלבד, באותו דפוס `_SAFE_FIELDS`).

### 2.6 מה אין ב-0.19.1 — בכנות

- **אין אירוע WS גלובלי "session נוצר" / "cron רץ"** על ה-socket שה-companion מחובר אליו (tui_gateway): האירועים הם per-session של שיחות המשטח (`message.*`, `tool.*`, `status.update`… — `src/lib/hermes/chat-events.ts:103-195`). לכן הפיד לא יכול "להתעורר" מאירוע ריצת-רקע; הרענון הוא polling/focus/יזום (סעיף 7). הערה: ה-spec האחי (live-refresh) מצא אירועי `*.changed` גלובליים — ר' שם.
- **אין endpoint ‏"feed"** מוכן — האגרגציה היא שלנו, בצד ה-main.

---

## 3. ארכיטקטורה

```
Hermes dashboard REST (localhost, session token)
  /api/cron/jobs ─┐
  /api/cron/jobs/{id}/runs ─┤       electron/partner-feed.cjs        ipc.cjs                preload.cjs
  /api/sessions ─┤  ──────▶  (אגרגציה + הקרנת allow-list  ──▶  'hermes:partner:feed' ──▶ getPartnerFeed()
  /api/curator, /api/learning/graph ─┘   + דגלי ok פר-מקור)                                      │
                                                                                                 ▼
                                                        src/lib/hermes/desktop.ts (facade, 3 מצבים)
                                                                                                 │
                                          src/lib/partner-feed.ts (גזירה טהורה → פריטים בעברית) │
                                                                                                 ▼
                                              src/hooks/usePartnerFeed.ts ──▶ PartnerFeedPanel (TasksScreen)
```

**החלטה: האגרגציה ב-main process, לא ב-renderer.** נימוקים:
1. תקדים זהה קיים ועובד: `electron/curator-insights.cjs` (קריאות `hermesApi` + IPC ייעודי) ו-`electron/partner-cron.cjs` (client ל-cron REST עם `api` מוזרק).
2. `hermesApi` (`electron/runtime.cjs:36-54`) מצרף את ה-session token ב-main; ה-renderer לא נוגע ב-endpoints חדשים ⇒ **אפס שינוי ב-`ALLOWED_API_ROUTES`** (סעיף 5).
3. אגרגציה של 3+ קריאות ב-round-trip ‏IPC אחד; הקרנת allow-list לפני חציית הגבול (פרטיות, סעיף 8).
4. הליבה נבדקת ב-vitest colocated עם `api` מוזרק — בלי Electron ובלי jsdom (בדיוק כמו `curator-insights.test.ts`, `partner-checkins.test.ts`).

**חלוקת אחריות:** ‏main מחזיר נתונים מוקרנים + דגלי `ok` פר-מקור, **בלי עברית ובלי ניסוח**; ה-renderer (`src/lib/partner-feed.ts`, מודול טהור) גוזר פריטי תצוגה — אותה חלוקה כמו curator-insights (גשר גולמי ↔ `deriveCuratorNotifications`).

---

## 4. מודל נתונים

### 4.1 מה שחוצה את ה-IPC (מ-main ל-renderer)

```ts
// חוזה הערוץ hermes:partner:feed. כל שדה שלא הוכח — null; כל מקור שנכשל — ok:false
// (לעולם לא רשימה ריקה "בריאה"). generatedAt מתעד מתי הראיות נאספו.
export type PartnerFeedSnapshot = {
  generatedAt: string                  // ISO, שעת האיסוף ב-main
  available: boolean                   // לפחות מקור אחד ענה (כמו curator-insights.available)
  cron: {
    ok: boolean                        // הקריאה ל-/api/cron/jobs הצליחה
    jobs: FeedCronJob[]                // מוקרן; ריק רק כשבאמת אין
  }
  sessions: { ok: boolean; rows: FeedSessionRow[] }
  curator: { ok: boolean; insights: CuratorInsights | null }   // הטיפוס הקיים מ-src/lib/hermes/curator.ts
}

export type FeedCronJob = {
  id: string
  name: string
  enabled: boolean
  schedule_display: string | null
  last_run_at: string | null           // ISO מ-Hermes; null = מעולם לא רץ / לא דווח
  last_status: 'ok' | 'error' | null   // null = לא דווח (fail-closed: לא "הצליח")
  next_run_at: string | null
  isPartnerCheckin: boolean            // isOwnedCheckin() מ-partner-checkin-def.cjs
  runs: FeedRunRow[]                   // עד 3 אחרונות, רק ל-jobs שרצו בחלון
}

export type FeedRunRow = {
  id: string                           // session id: cron_{job_id}_{timestamp}
  title: string | null
  started_at: number | null            // epoch seconds כפי ש-Hermes מחזיר
  ended_at: number | null
  message_count: number
  is_active: boolean
}

export type FeedSessionRow = {
  id: string
  source: string                       // 'telegram' / 'whatsapp' / כל פלטפורמה
  title: string | null
  preview: string | null               // ההודעה הראשונה של המשתמש (קיים כבר ב-sidebar)
  started_at: number | null
  last_active: number | null
  message_count: number
}
```

הקרנה ב-main היא **allow-list קשיח**: `prompt`, `deliver`, `system_prompt`, `model_config`, `input/output_tokens`, `cwd` וכל שדה אחר לא חוצים את הגבול (ר' סעיף 8).

### 4.2 פריט פיד (renderer, גזור)

```ts
export type PartnerFeedItemKind = 'checkin-run' | 'task-run' | 'background-session' | 'curator'

export type PartnerFeedItem = {
  id: string                           // יציב: session id של הריצה / session id / id של notification
  kind: PartnerFeedItemKind
  at: number | null                    // epoch ms מנורמל; null = "מועד לא ידוע" (מוצג, לא מוסתר)
  title: string                        // עברית, נגזר בלבד — לעולם לא מומצא מספר/עובדה
  detail?: string
  status: 'ok' | 'error' | 'unknown'   // 'unknown' כשאין הוכחה — מוצג כ"לא ידוע"
  sourceLabel?: string                 // 'טלגרם' / 'WhatsApp' / שם המשימה
  sessionId?: string                   // קיים ⇒ CTA "פתח את השיחה"
  jobId?: string
}

export type PartnerFeed = {
  items: PartnerFeedItem[]             // ממוינים חדש→ישן, cap 20, חלון 7 ימים
  degraded: { cron: boolean; sessions: boolean; curator: boolean }  // אילו מקורות לא נקראו
  available: boolean
}
```

כללי גזירה (ב-`derivePartnerFeed(snapshot, now)` — פונקציה טהורה):
- ריצת cron: פריט פר שורה ב-`runs`; `status` — אם זו הריצה שה-`last_run_at` של ה-job מצביע עליה, יורש את `last_status`; אחרת `'unknown'` (בכנות: אין סטטוס פר-ריצה ב-0.19.1, סעיף 2.1). כותרת check-in: "השותף ערך בדיקה תקופתית"; משימה רגילה: "המשימה ‚{name}' רצה".
- session רקע: "שיחה חדשה מ{sourceLabel}" + `preview` קטום ל-120 תווים; `sourceLabel` ממופה לעברית לערוצים המוכרים (`telegram`→"טלגרם", `whatsapp*`→"WhatsApp") ואחרת ה-source כלשונו.
- curator: עד 2 פריטים מ-`deriveCuratorNotifications` הקיים (`at` = `last_run_at` של ה-curator אם קיים, אחרת `null`).
- מיון לפי `at` יורד; `at:null` בסוף עם "מועד לא ידוע".

---

## 5. ‏ALLOWED_API_ROUTES — אין תוספות

`ALLOWED_API_ROUTES` (`electron/ipc-guards.cjs:89-101`) שומר על ערוץ `hermes:api` של ה-**renderer** בלבד; קריאות `hermesApi` מ-main אינן עוברות דרכו (`electron/ipc.cjs:95-97`). מכיוון שהאגרגציה יושבת ב-`electron/partner-feed.cjs`, ה-renderer לא מוסיף אף ליטרל `/api/…` — ובדיקת ה-lockstep שסורקת את `src/` (`electron/ipc-guards.test.ts`) נשארת ירוקה ללא שינוי. **זה חלק מהתכנון, לא מקרה.**

לתשומת לב מי שיישם: אם מישהו יבחר בכל-זאת לקרוא מה-renderer (לא מומלץ), יידרשו: תוספת `runs` ל-regex של cron, תוספת `^\/api\/sessions$`, מפתחות query חדשים (`limit`, `offset`, `order`, `exclude_sources`) — וגם הרחבת `API_QUERY_VALUE` כי פסיק (`sources=a,b`) אינו ב-`SEG`. זו בדיוק החיכוך שהארכיטקטורה הנבחרת חוסכת.

`electron/partner-feed.cjs` יבצע (עם `api` מוזרק, ברירת מחדל `require('./runtime.cjs').hermesApi`):
1. `GET /api/cron/jobs?profile=default`
2. עד 5× `GET /api/cron/jobs/{id}/runs?profile=default&limit=3` — רק ל-jobs עם `last_run_at` בחלון 7 הימים (תיחום ה-N+1)
3. `GET /api/sessions?profile=default&limit=30&order=recent` — סינון deny-list ב-main (סעיף 2.3); בלי `exclude_sources` בשרת כדי לא להיקשר לרשימת שמות (הסינון אצלנו ממילא)
4. `getCuratorInsights(api)` — שימוש חוזר במודול הקיים `curator-insights.cjs`

כל קריאה עטופה `safeGet`-סגנון (כמו `curator-insights.cjs:17-24`): כשל ⇒ `ok:false` לאותו מקור, לעולם לא זריקה שמפילה את השאר, ולעולם לא `[]` שמתחזה להצלחה.

---

## 6. עיצוב UI (טקסטואלי)

### 6.1 מיקום

המסך `tasks` — שכבר קרוי בניווט **"פעילות ומשימות"** (`src/constants.ts:21`) — הופך לבית הפעילות. מבנה חדש של `TasksScreen`:

1. **כותרת עמוד** (קיימת).
2. **חדש — פאנל "מה השותף עשה בשבילך"** (`PartnerFeedPanel`, `section.panel` בראש המסך, לפני `stats-row`): רשימת עד 20 פריטים, כל שורה בדפוס `task-row` הקיים — אייקון סטטוס בצד ימין (RTL: האפליקציה כולה RTL, אין צורך בטיפול מיוחד — `dir` גלובלי; להשתמש ב-logical properties ב-CSS כמו שנקבע בשלב 5.2 של תוכנית השיפור), כותרת + detail, חותם-זמן "לפני X" (לחלץ את `timeAgo` מ-`src/lib/hermes/curator.ts:44-55` למודול משותף `src/lib/presentation.ts` במקום לשכפל), ו-CTA.
3. **סטטיסטיקות ורשימת המשימות** (קיימות, ללא שינוי).

### 6.2 שורת פריט

- `checkin-run` — אייקון `HeartHandshake`/`CalendarClock`; ‏"השותף ערך בדיקה תקופתית · לפני 3 שעות" ; סטטוס: ‏ok=וי ירוק, error="נכשלה" באדום, unknown="תוצאה לא ידועה" באפור. CTA: "פתח את השיחה".
- `task-run` — "המשימה ‚סיכום שבועי' רצה · אתמול ב-09:00"; אותם סטטוסים; CTA זהה.
- `background-session` — אייקון הערוץ; "שיחה חדשה מטלגרם · לפני 20 דקות"; detail = ‏preview קטום; CTA: "פתח את השיחה".
- `curator` — אייקון `WandSparkles`; הטקסטים הקיימים של `deriveCuratorNotifications`; בלי CTA.

CTA "פתח את השיחה": ניווט ל-`chat` + ‏`chat.selectSession(sessionId)` (אותו מסלול של ה-Sidebar, `FullAppShell.tsx:54`). נדרש חיווט prop חדש: ‏`MainScreen`/`TasksScreen` יקבלו `onOpenSession(id)` מ-App (ר' סיכון 10.3).

### 6.3 מצבי ריק ו-fail-closed

לפי דפוס `list-state` הקיים (`TasksScreen.tsx:73-91`):

| מצב | תצוגה |
|---|---|
| טוען (אין snapshot עדיין) | "טוען את פעילות השותף…" (`role="status"`) |
| `available:false` (runtime נפול / הגשר חסר / כל המקורות נכשלו) | `list-state--error`: **"לא הצלחנו לקרוא את פעילות השותף"** + "ייתכן שהחיבור ל-Hermes נקטע…" — לעולם לא "אין פעילות" |
| `available:true` אך `items.length===0` | "עוד לא נרשמה פעילות ברקע" + "כשמשימה מתוזמנת תרוץ או שתגיע שיחה מהטלפון — תראו את זה כאן." (+כפתור "משימה חדשה") |
| דגרדציה חלקית (`degraded.x===true` אך יש פריטים) | הפריטים מוצגים + שורת אזהרה מושתקת: "חלק מהנתונים לא נקראו הפעם (…)" — פירוט המקור שנכשל |
| `status:'unknown'` על פריט | תג "תוצאה לא ידועה" — לא מוסתר ולא מוצג כהצלחה |

### 6.4 תג "חדש" בניווט (שלב 5, אופציונלי)

Badge על פריט הניווט "פעילות ומשימות" עם מספר הפריטים שה-`at` שלהם מאוחר מחותם "נצפה לאחרונה" הנשמר ב-localStorage (מפתח `hermes-business-feed-seen-v1`). זהו סמן-צפייה בצד הלקוח בלבד — לא ראיה — ולכן localStorage מותר כאן (בשונה משער ה-onboarding).

---

## 7. אסטרטגיית רענון — הממשק המונח

ה-spec האחי (roadmap סעיף 2) מתכנן רענון מונע-אירועים. **אנחנו מניחים** שהוא יספק hook בסגנון:

```ts
// מסופק ע"י ה-spec האחי; אנו רק צרכנים.
useServerRefresh({
  key: 'partner-feed',
  refetch: () => Promise<void>,     // ה-refetch שלנו
  triggers: ['reconnect', 'focus', 'interval'],
  minIntervalMs: 30_000             // throttle
})
```

עד שהוא קיים, `usePartnerFeed` עומד ברשות עצמו:
1. ‏fetch במעבר למסך `tasks` (ולא בכל mount של האפליקציה).
2. ‏refetch יזום אחרי `taskActions.onTrigger` (המשתמש הריץ עכשיו — הריצה צריכה להופיע).
3. כפתור "רענון" ידני בפאנל.
4. ‏re-fetch על חזרת חלון לפוקוס אם עברו >60 שניות (מימוש מינימלי, יוחלף ב-hook האחי).

החוזה שלנו כלפי ה-hook העתידי: `usePartnerFeed` חושף `{ feed, loading, refresh }` כאשר `refresh` אידמפוטנטי, בטוח לקריאה מקבילה (in-flight dedup), ולא זורק (כשל ⇒ `available:false`).

---

## 8. פרטיות

1. **הכול מקומי**: הנתונים עוברים רק localhost→main→renderer; אין egress חדש.
2. **הקרנת allow-list ב-main** (סעיף 4.1): ‏`prompt` של job, ‏`deliver`, ‏`system_prompt`, טוקנים, ‏`cwd` — לא חוצים את ה-IPC. ‏`preview`/`title` כן עוברים (הם כבר מוצגים היום ב-sidebar דרך `session.list`) — אין הרחבת חשיפה מעבר לקיים.
3. **לוגים**: ‏`partner-feed.cjs` לא כותב את תוכן ה-snapshot ללוג. שגיאות נרשמות דרך המסלול הקיים בלבד (redaction ב-`redact.cjs`).
4. **חבילת אבחון**: ‏`createDiagnosticsBundle` לא יכלול פריטי פיד (עקבי עם "לוגים גולמיים נשארים בחוץ" — improvement-plan שורות 113-114). מותר לכלול מונים בלבד (למשל `feedItemCount`) אם יידרש.
5. ‏curator — נתונים אגרגטיביים בלבד (מונים/חותמות זמן), כמו היום.

---

## 9. תוכנית בדיקות

### colocated vitest — עכשיו (בלי jsdom)

| קובץ | מה נבדק |
|---|---|
| `electron/partner-feed.test.ts` | ‏`api` מוזרק (כמו `curator-insights.test.ts`): הרכבת snapshot; כשל מקור בודד ⇒ `ok:false` לאותו מקור והשאר שלמים; כשל כולל ⇒ `available:false`; הקרנה — snapshot **לא** מכיל `prompt`/`deliver`/`system_prompt` (בדיקת deny מפורשת); תיחום N+1 (עד 5 jobs, ‏limit=3); זיהוי check-in דרך `isOwnedCheckin`; צורות תשובה שונות (`{jobs:[…]}` מול מערך — כמו `partner-cron.cjs:22`) |
| `src/lib/partner-feed.test.ts` | ‏`derivePartnerFeed` טהורה: מיזוג/מיון/cap/חלון-זמן; `at:null` בסוף; ‏`status:'unknown'` כשאין הוכחה (ריצה שאינה האחרונה); ‏`last_status:null` לא הופך ל-ok; מיפוי source→עברית + ‏fallback לשם הגולמי; קיטום preview; פריט curator נעדר כשה-insights לא זמינים |
| `electron/preload.test.ts` (הרחבה) | הערוץ החדש קיים על הגשר ועובר דרך `invoke` (נורמליזציית שגיאות) |
| `src/lib/hermes/desktop.test.ts` (הרחבה) | ‏facade: גשר קיים ⇒ delegate; חסר ⇒ דחייה עם `BRIDGE_UNAVAILABLE`; demo ⇒ fixture |
| `src/lib/hermes/demo-strip.test.ts` | (קיים) ממשיך להבטיח שה-fixture לא דולף ל-production |

### נדחה לתשתית jsdom העתידית (roadmap 3)
רינדור `PartnerFeedPanel`: מצבי טעינה/ריק/שגיאה/דגרדציה; ‏CTA מנווט ופותח session; ‏badge הניווט. עד אז — כיסוי הלוגיקה נמצא כולו במודולים הטהורים לעיל, והקומפוננטה נשארת דקה בכוונה.

### שערים
`npm test` מלא אחרי כל שלב; אין נגיעה ב-`hermes-plugin/` ⇒ ‏`verify:plugin` לא נדרש אך לא אמור להישבר.

---

## 10. סיכונים

1. **דריפט בתוך 0.19.x** — ‏`/runs` אומת ב-0.19.1 בלבד (בתוך הטווח הנתמך). מיטיגציה: כשל route ⇒ ‏`cron.ok:false` ⇒ ‏UI מציג דגרדציה כנה; אין קריסה.
2. **סטטוס פר-ריצה לא קיים רשמית** — ‏`last_status` מכסה רק את הריצה האחרונה. אנו מציגים `unknown` לריצות ישנות. פיתוי עתידי לפרסר את `executions.db` ישירות — **אסור** (דלת לא רשמית); המסלול הנכון: הרחבת plugin (סעיף 2.5).
3. **‏`session.resume` על session של cron** — ‏resume עובד על sessions מאוחסנים (`resolve_resume_session_id`), אך לא אומת חי על `source='cron'`. שלב 4 כולל אימות ידני; אם ייכשל — ‏CTA fallback: ‏`openFullSurface('desktop')` (קיים ב-facade) עם טקסט "פתח ב-Hermes המלא".
4. **תוויות source לא צפויות** — פלטפורמה חדשה תוצג בשמה הגולמי (לא נחסמת). זה מכוון.
5. **עומס** — עד 7 קריאות REST פר רענון; כולן מקומיות, עם throttle 30s. תיחום ה-runs ל-jobs פעילים-לאחרונה שומר את זה קבוע.
6. **כפילות מול ה-sidebar** — ‏sessions של רקע מופיעים גם ב-`session.list` של ה-sidebar. לא באג (אותו מקור אמת), אך יש לוודא שהפיד לא יוצר רושם של "שני מקומות שונים" — הכותרות חייבות להיגזר מאותם שדות (`title`/`preview`).

---

## 11. שלבי מימוש (כל שלב עצמאי, בגודל לסוכן Sonnet)

### שלב 1 — דלת הנתונים ב-main: `electron/partner-feed.cjs` + בדיקות
קבצים: `electron/partner-feed.cjs` (חדש), `electron/partner-feed.test.ts` (חדש).
מימוש: `getPartnerFeed(api = require('./runtime.cjs').hermesApi)` לפי סעיפים 4.1+5; שימוש ב-`isOwnedCheckin`/`cronJobId` מ-`partner-checkin-def.cjs`/`cron-identity.cjs`; ‏`safeGet` פר-מקור.
**קבלה:** כל תרחישי הבדיקה מסעיף 9 עוברים; אין `require` של Electron בטעינת המודול (בדיקה נטענת ללא סביבת Electron); ‏snapshot לעולם לא מכיל שדה מחוץ ל-allow-list; `npm test` ירוק.

### שלב 2 — חיווט הגבול: IPC ‏+ preload ‏+ facade ‏+ demo
קבצים: `electron/ipc.cjs` (שורה אחת: ‏`ipcMain.handle('hermes:partner:feed', () => getPartnerFeed())`), ‏`electron/preload.cjs` (‏`getPartnerFeed`), ‏`src/vite-env.d.ts` (הצהרה), ‏`src/lib/hermes/desktop.ts` (+`getPartnerFeed(): Promise<PartnerFeedSnapshot>`), ‏`src/lib/hermes/demo-desktop.ts` (fixture נאמן: ‏snapshot עם ריצת check-in אחת, session טלגרם אחד, curator), הרחבות `preload.test.ts`/`desktop.test.ts`.
**קבלה:** שלושת מצבי ה-facade עובדים (bridge/demo/missing⇒throw); הצהרות types מסונכרנות; `npm test` ירוק.

### שלב 3 — גזירת התצוגה: `src/lib/partner-feed.ts` + בדיקות
קבצים: `src/lib/partner-feed.ts` (חדש; ‏types מסעיף 4.2 + ‏`derivePartnerFeed`), ‏`src/lib/partner-feed.test.ts` (חדש); חילוץ `timeAgo` מ-`curator.ts` ל-`presentation.ts` (עם שמירת ה-import הקיים).
**קבלה:** כל תרחישי הגזירה מסעיף 9; אף מחרוזת אינה מכילה עובדה שאינה בקלט; `npm test` ירוק.

### שלב 4 — UI: ‏`PartnerFeedPanel` + ‏`usePartnerFeed` + חיווט CTA
קבצים: `src/hooks/usePartnerFeed.ts` (חדש), `src/components/screens/PartnerFeedPanel.tsx` (חדש), `src/components/screens/TasksScreen.tsx` (הוספת הפאנל), `src/components/MainScreen.tsx` + `src/components/FullAppShell.tsx` + `src/App.tsx` (העברת `onOpenSession` המחבר ל-`chat.selectSession` + `setScreen('chat')`), CSS לפי מחלקות קיימות (`panel`, `task-row`, `list-state`).
**קבלה:** כל מצבי סעיף 6.3 ממומשים; אימות ידני — ריצת check-in אמיתית מופיעה ונפתחת בצ'אט (או fallback סיכון 10.3 מתועד); `npm run build` + `npm test` ירוקים.

### שלב 5 — רענון וליטוש
קבצים: `usePartnerFeed.ts` (טריגרים מסעיף 7: ‏trigger-refetch, ‏focus>60s, ‏dedup ‏in-flight), ‏badge "חדש" בניווט (`Sidebar.tsx`, ‏localStorage seen-marker), עדכון `docs/improvement-plan.md` (סימון סעיף 1 בביצוע/הושלם).
**קבלה:** ‏refetch אחרי "הרץ עכשיו" מציג את הריצה החדשה; אין רענון בתדירות גבוהה מ-30s; ‏badge מתאפס בכניסה למסך; `npm test` ירוק.

---

## נספח: קבצים קריטיים למימוש

- `electron/partner-feed.cjs` (חדש — ליבת הפיצ'ר; לפי התקדים `electron/curator-insights.cjs` + `electron/partner-cron.cjs`)
- `electron/ipc.cjs` (רישום הערוץ `hermes:partner:feed`; ר' `electron/ipc-guards.cjs` — אין תוספות allow-list)
- `src/lib/hermes/desktop.ts` (הרחבת ה-facade + ‏demo fixture ב-`src/lib/hermes/demo-desktop.ts`)
- `src/lib/partner-feed.ts` (חדש — גזירה טהורה של פריטי הפיד בעברית)
- `src/components/screens/TasksScreen.tsx` (מיקום הפאנל במסך "פעילות ומשימות")

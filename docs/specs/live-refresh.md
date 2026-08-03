# אפיון: רענון מצב-שרת מונע-אירועים (Live Refresh) — תכל'ס

**מסמך:** `docs/specs/live-refresh.md`
**ריפו:** `C:\projects\hermes-business-poc`
**גרסת Hermes שנבדקה:** 0.19.1 (מותקן ב-`%LOCALAPPDATA%\hermes\hermes-agent`, אומת מ-`hermes_agent.egg-info\PKG-INFO`)
**סטטוס:** מאושר לתכנון · מחולק לפאזות בגודל Sonnet-subagent

---

## 1. מטרות / לא-מטרות

### מטרות
1. **רענון מונע-אירועים**: רשימות ה-cron, הסשנים, פלטפורמות ההודעות וסטטוס הבריאות מתעדכנים לבד כאשר ה-backend משתנה — דרך אירועי ה-WS הרשמיים של Hermes 0.19.1 (`cron.changed`, `sessions.changed`, `platforms.changed`), בלי polling צפוף.
2. **רענון על reconnect**: כל slice מתרענן אוטומטית כשהחיבור חוזר אחרי ניתוק (אותו עיקרון כמו `session.resume` הקיים ב-`useChat`).
3. **רענון על window focus**: חזרה לחלון מפעילה רענון (עם סף מינימלי בין רענונים).
4. **חוזה staleness כן (fail-closed)**: חיבור WS שנפל ⇒ ה-UI מציג במפורש "מנותק / הנתונים אינם עדכניים". לעולם לא מציגים נתונים ישנים כטריים, ולעולם לא ממציאים אירועים.
5. **API מנוי לצרכנים**: hook בשם `useServerState(slice)` ש-spec-partner-feed (האפיון האח) יכול לצרוך.

### לא-מטרות
- **לא** ממציאים אירועים ש-Hermes לא משדר (אין `skills.changed`, אין `health.changed`, אין `config.changed` — ראו §3.4; ל-slices אלה fallback כן בלבד).
- **לא** משכתבים את שכבת הצ'אט (`useChat` + `chat-events.ts`) — היא כבר מונעת-אירועים ונשארת כמות שהיא.
- **לא** מוסיפים polling חדש בקצב מהיר; backstop איטי בלבד (ראו §5.4).
- **לא** נפתחת דלת רשת חדשה: אין endpoints חדשים ב-`ALLOWED_API_ROUTES`, אין ערוצי invoke חדשים ב-IPC (ראו §6).
- **לא** תומכים בריבוי פרופילים (התכל'ס עובד מול פרופיל `default` יחיד).

---

## 2. מצב קיים (ממצאי חקירה)

### 2.1 איך ה-renderer קורא נתונים היום
- `src/hooks/useHermesData.ts:30-82` — פונקציית `refresh()` מונוליטית אחת: `listSessions` (RPC על WS), `listTasks` + `listMessagingPlatforms` + `/api/env` (REST דרך `hermes:api`), `getGoogleStatus`/`getVersions` (IPC). רצה **פעם אחת ב-mount** ואחרי mutations (`onRefresh` במודאלים). **אין אף `setInterval` ב-`src/`** (אומת ב-grep) — הנתונים פשוט מתיישנים.
- `loadErrors` (`useHermesData.ts:28`) כבר מיישם fail-closed לקריאת רשימות: קריאה שנכשלה ≠ רשימה ריקה בריאה. האפיון הזה מרחיב את אותה דוקטרינה לממד הזמן.

### 2.2 ה-renderer כבר מחזיק WS ישיר לשער — זו הדלת הקיימת
- `electron/runtime-state.cjs:20` — main בונה `wsUrl` עם `?token=` (ה-session token) ומוסר אותו ל-renderer בתוך `runtimeState` (מוקלד ב-`src/vite-env.d.ts:22`).
- `src/lib/hermes-client.ts:89` — `boot()` מבצע `transport.connect(runtime.wsUrl)`; הצ'אט כולו רץ על הסוקט הזה.
- `src/lib/hermes/transport.ts` — טרנספורט JSON-RPC מלא: reconnect עם backoff+jitter (שורות 295-330), מצב חיבור `'open' | 'closed' | 'reconnecting'` (שורה 8), fan-out של אירועים (`onEvent`, שורה 111), מנויי `onConnectionChange` (שורה 120). frame בפורמט `{method:'event', params:{type,...}}` מנותב ב-`attachHandlers` (שורות 275-276).
- `src/lib/hermes/chat-resume.ts` — tracker טהור שכבר מזהה "open שאחרי נפילה" (משמש ל-`session.resume` ב-`useChat.ts:51-61`).

### 2.3 תשתית push קיימת main→renderer (תבנית לחיקוי אם יידרש)
- `electron/logs.cjs:20` — `webContents.send('hermes:runtime-log', line)`.
- `electron/preload.cjs:86-90` — `onRuntimeLog(callback)` עם unsubscribe; מכוסה lockstep ב-`electron/preload.test.ts:179-191`.

---

## 3. דלת האירועים הרשמית של Hermes 0.19.1 — ראיות (file:line)

כל הנתיבים תחת `%LOCALAPPDATA%\hermes\hermes-agent\`.

### 3.1 ה-endpoint והאימות
- `hermes_cli/web_server.py:15574-15590` — `@app.websocket("/api/ws")` → `_ws_auth_ok` → `tui_gateway.ws.handle_ws`.
- `hermes_cli/web_server.py:14484-14489` — במצב loopback לא-שערי (המצב שלנו): אימות `?token=` מול `_SESSION_TOKEN` ב-`hmac.compare_digest`. תואם בדיוק ל-`electron/hermes-auth.cjs` (`wsUrlWithToken`) ולהערה ב-`runtime-state.cjs:18-19`.

### 3.2 הכרזת יכולת: `gateway.ready` עם `change_events: true`
- `tui_gateway/ws.py:306-318` — מיד אחרי accept נשלח:
  ```json
  {"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"skin":"...","change_events":true}}}
  ```
  עם ההערה הרשמית: *"this backend broadcasts pet.changed / cron.changed / sessions.changed, so clients can demote their legacy polls to slow backstops"*. אחרי שליחה מוצלחת: `server._ensure_skin_watcher()` (מתניע את ה-change watcher) ו-`server.register_live_transport(transport)` (רישום ל-broadcast גלובלי, `ws.py:321-324`).

### 3.3 אירועי השינוי המשודרים — הרשימה המלאה
- `tui_gateway/server.py:3129-3135` — `_CHANGE_WATCHES` (אירוע → אינטרוול בדיקה, פונקציית חתימה, payload):

| אירוע | אינטרוול | חתימה (מקור אמת) | floor שידור |
|---|---|---|---|
| `cron.changed` | 1.0s | mtime של `cron/jobs.json` — זז ב-create/edit/pause/remove **וגם** ב-tick של ה-scheduler (`last_run`/`next_run`) — `server.py:3050-3056` | — |
| `sessions.changed` | 0.5s | mtime מקסימלי של `state.db`/`state.db-wal` — כולל turns של messaging-gateway וריצות cron מתהליכים אחרים — `server.py:3059-3072` | 2.0s (`server.py:3141`) |
| `platforms.changed` | 2.0s | mtime של `gateway_state.json` — connect/disconnect/health של פלטפורמות הודעות — `server.py:3075-3082` | 5.0s |
| `pairing.changed` | 2.0s | mtimes של קבצי pairing — `server.py:3085-3122` | — |
| `pet.changed` | 2.0s | ספרייט ה-pet — `server.py:3010-3047` | — |
| `skin.changed` | (watcher ייעודי) | `server.py:2984-3002` | — |

- מנגנון השידור: `_broadcast_watched_changes` (`server.py:3148-3176`; ה-sighting הראשון נזרע בשקט — אין "סערת רענון" בעליית gateway), על thread ברקע בקצב 0.5s (`_ensure_skin_watcher`, `server.py:3182-3201`), דרך `_broadcast_global_event` (`server.py:1392-1413`) לכל transport רשום.
- צורת ה-frame: `_event_frame` (`server.py:1359-1363`) — `{"jsonrpc":"2.0","method":"event","params":{"type":<event>,"session_id":"","payload":{...}}}`. בדיוק מה ש-`transport.ts:275-276` שלנו כבר יודע לנתב אל `onEvent`.

### 3.4 מה **אין** — הגבולות הכנים
אין ב-0.19.1 אירועי `health.*`, `config.changed`, `skills.changed` או `update.status` (נבדק: `_CHANGE_WATCHES` היא הרשימה הסגורה). לכן:
- **health**, **skills**, **provider/env** — מתרעננים רק על reconnect / focus / פעולה ידנית / אחרי mutation. לא ממציאים.
- `pairing.changed`, `pet.changed`, `skin.changed` — אין להם צרכן בתכל'ס; מתועדים ומתעלמים (ולא נרשמים ל-slice).

### 3.5 כך ה-UI הרשמי של Hermes צורך את זה — התבנית שאנחנו מעתיקים
- `apps/desktop/src/store/live-sync.ts` — atoms ברמת module: `$changeEventsAvailable` (שער תאימות שנזרע מ-`gateway.ready`), `$cronChangeTick`/`$sessionsChangeTick`/`$platformsChangeTick` (מוני tick), ו-`resetLiveSync()` על reconnect ("stale ticks must not fire refreshes").
- `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event.ts:285-331` — ניתוב האירועים: `gateway.ready` ⇒ `setChangeEventsAvailable(payload.change_events)`; `cron.changed`/`platforms.changed`/`sessions.changed` ⇒ `notify*Changed()`.
- `apps/desktop/src/app/contrib/hooks/use-background-sync.ts:24-44` — הדגימה של "בלי סערת polling": עם אירועים ה-polls יורדים ל-backstop איטי (`CRON_BACKSTOP_INTERVAL_MS = 5*60_000`); בלי (`change_events` חסר ⇒ backend ישן) נשארים בקצב legacy (`CRON_POLL_INTERVAL_MS = 30_000`); רענוני רשימת sessions מרוככים ב-trailing-edge gap של 10s (`SESSIONS_LIST_TICK_GAP_MS`, שורה 44).

---

## 4. הכרעה ארכיטקטונית: WS בבעלות ה-renderer (הקיים), לא חיבור חדש ב-main

**הוחלט: להשתמש בחיבור ה-WS היחיד הקיים של ה-renderer (`hermesClient.transport`) ולנתב ממנו את אירועי השינוי.** אין חיבור WS חדש ב-main ואין forwarding של אירועים על IPC.

נימוקים:
1. **זו כבר הדלת המאושרת.** ה-renderer מתחבר ישירות ל-`/api/ws` מאז ומעולם (הצ'אט כולו; `hermes-client.ts:89`), וה-token נמסר לו בכוונה (`runtime-state.cjs:20`, `vite-env.d.ts:22`). "renderer מגיע ל-Hermes רק דרך `hermes:api`" נכון לגבי **REST** בלבד; ל-WS יש נתיב renderer רשמי קיים. אין שום סוד חדש שנחשף.
2. **חיבור אחד, לא שניים.** ה-gateway קושר סשנים ל-connection שבו נוצרו (`transport.ts:69-74`, וההערה ב-`ws.py` על teardown). הצ'אט חייב להישאר על הסוקט של ה-renderer; חיבור נוסף ב-main היה יוצר שני סוקטים חיים, שתי מכונות reconnect, ומקור staleness שני שצריך לתאם — בדיוק "polling storm" בתחפושת.
3. **תואם לתבנית הרשמית.** ה-desktop של Hermes עצמו צורך את change events על אותו סוקט של הצ'אט (§3.5). מעתיקים, לא ממציאים.
4. **Fail-closed טבעי.** `ConnectionState` של הטרנספורט הוא מקור האמת היחיד ל-staleness. תיווך IPC היה מוסיף שכבה שיכולה לשקר (main מחובר, renderer לא — או להפך).
5. **אפס שינוי בשטח התקיפה.** אין ערוץ IPC חדש, אין route חדש ב-allow-list, אין שינוי ב-preload.

**Trade-off מתועד:** slices שמקורם ב-main בלבד (partner state, WhatsApp guard) לא מקבלים push; הם מתרעננים על reconnect/focus/אחרי-mutation, ובמקרה של partner — גם על `cron.changed` (ה-check-ins יושבים ב-cron הרשמי). אם בעתיד יידרש push מ-main (למשל ל-partner-feed), התבנית היא `hermes:runtime-log` (`logs.cjs:20` + `preload.cjs:86-90`) — פאזה 6 האופציונלית מפרטת.

### 4.1 תרשים

```
Hermes gateway (127.0.0.1:<port>)
  ├── change watcher thread (server.py:3195-3201, 0.5s tick)
  │     cron/jobs.json ─ mtime ──► cron.changed ─┐
  │     state.db(+wal) ─ mtime ──► sessions.changed ─┤ _broadcast_global_event
  │     gateway_state.json mtime ► platforms.changed ┘ (server.py:1392)
  └── /api/ws (?token=SESSION_TOKEN)  ◄── חיבור יחיד, קיים
        │
        ▼
Renderer: HermesTransport (src/lib/hermes/transport.ts)
  ├── onEvent ──► chat-events.ts (קיים, ללא שינוי)
  │          └─► live-refresh.ts (חדש): routeChangeEvent(event) → invalidate(slice)
  ├── onConnectionChange ──► server-state.ts (חדש): freshness מכונת-מצבים
  │                          'closed'/'reconnecting' ⇒ הכול stale(disconnected)
  │                          'open' אחרי נפילה ⇒ refreshAll()
  └── gateway.ready.payload.change_events ⇒ שער תאימות (backstop איטי/legacy)

window 'focus'/'visibilitychange' ──► server-state.refreshAll({minGapMs})

server-state store (module-level, חדש: src/lib/server-state.ts)
  slices: sessions │ schedule │ connections │ health │ partner
  לכל slice: fetcher, lastSyncedAt, freshness, in-flight dedupe, coalesce gap
        │
        ▼
useServerState(slice) (חדש: src/hooks/useServerState.ts)
  ├── useHermesData (מרוענן דרך ticks — פאזה 3)
  └── partner-feed (האפיון האח — צרכן עתידי)
```

---

## 5. עיצוב מפורט — צד renderer

### 5.1 מיפוי אירוע → slice

| אירוע gateway | slices מרועננים | fetcher (facade קיים) |
|---|---|---|
| `sessions.changed` | `sessions` | `hermesClient.listSessions()` (RPC `session.list`, `session.ts:60-62`) |
| `cron.changed` | `schedule`, `partner` | `hermesClient.listTasks()` (`rest-cron.ts:22`); `hermesClient.getPartnerState()` (IPC) |
| `platforms.changed` | `connections` | `hermesClient.listMessagingPlatforms()` (`rest-messaging.ts:23`) + `getGoogleStatus()` |
| `gateway.ready` | שער `change_events` + זריעת freshness | — |
| `pairing.changed`, `pet.changed`, `skin.changed` | — (אין צרכן; מתועד) | — |
| *(אין אירוע)* | `health` | `hermesClient.healthCheck()` — reconnect/focus/ידני בלבד |

### 5.2 מודול טהור: `src/lib/live-refresh.ts` (חדש)
- `export const CHANGE_EVENT_SLICES: Record<string, ServerStateSlice[]>` — **מקור אמת יחיד** למיפוי (נבדק lockstep, §8).
- `routeChangeEvent(event: GatewayEvent): ServerStateSlice[]` — טהור; מחזיר `[]` לאירוע לא מוכר (אסור לזרוק — אירועים חדשים של backend עתידי לא מפילים את ה-UI).
- `readChangeEventsCapability(event: GatewayEvent): boolean | null` — מחלץ `payload.change_events` מ-`gateway.ready`; `null` לכל אירוע אחר. ברירת מחדל של השער: `false` (fail-closed — backend ישן ⇒ קצב legacy, כמו הרשמי).

### 5.3 store ברמת module: `src/lib/server-state.ts` (חדש)
מקביל ל-`live-sync.ts` הרשמי, בלי תלות חדשה (listener-set ידני, כמו שהריפו נוהג; לא מוסיפים nanostores):

```ts
export type ServerStateSlice = 'sessions' | 'schedule' | 'connections' | 'health' | 'partner'

// fail-closed: אין מצב "טרי" מרומז. טרי = קריאה שהצליחה + חיבור חי.
export type SliceFreshness =
  | { kind: 'unknown' }                                   // טרם נטען
  | { kind: 'live' }                                      // WS open + change_events
  | { kind: 'degraded' }                                  // WS open, בלי change_events (backstop)
  | { kind: 'stale'; since: number; reason: 'disconnected' | 'load-failed' }

export type SliceStatus = {
  freshness: SliceFreshness
  lastSyncedAt: number | null    // Date.now() של הקריאה המוצלחת האחרונה
  refreshing: boolean
}

export type ServerStateTimers = {   // מוזרק לטסטים, כמו TransportTimers (transport.ts:24-28)
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
  now: () => number
}

export function createServerStateStore(deps: {
  fetchers: Record<ServerStateSlice, () => Promise<void>>  // מריצים setState חיצוני; זריקה = כשל
  timers?: Partial<ServerStateTimers>
  coalesceMs?: Partial<Record<ServerStateSlice, number>>   // ברירת מחדל: sessions 10_000 (כמו הרשמי), אחרים 1_000
  focusMinGapMs?: number                                    // ברירת מחדל 15_000
}): ServerStateStore
```

חוקי הליבה (כולם נבדקים ביחידה):
1. **Invalidate ⇒ רענון trailing-edge**: `invalidate(slice)` בתוך חלון ה-coalesce מתזמן רענון אחד בסוף החלון (הכתיבה האחרונה של burst תמיד נוחתת — כמו `SESSIONS_LIST_TICK_GAP_MS` הרשמי).
2. **In-flight יחיד לכל slice**: רענון בזמן רענון ⇒ מסומן `pendingAgain` ורץ שוב פעם אחת בסיום. אין שניים במקביל.
3. **Freshness fail-closed**: `connectionChanged('closed'|'reconnecting')` ⇒ **כל** ה-slices עוברים מיידית ל-`stale(disconnected)`; fetcher שנכשל ⇒ `stale(load-failed)` (ה-data הקיים נשאר מוצג אך מסומן). `live`/`degraded` נקבעים **רק** אחרי fetcher שהצליח בזמן שהחיבור open.
4. **Reconnect**: `'open'` שאחרי נפילה (לוגיקת `createReconnectResumeTracker` הקיימת — `chat-resume.ts:20-38`, בשימוש חוזר) ⇒ `refreshAll()`. גם `gateway.ready` חדש מאפס את שער `change_events` לפני זריעה מחדש (כמו `resetLiveSync` הרשמי).
5. **Focus**: `refreshOnFocus()` מרענן רק אם עברו `focusMinGapMs` מאז הרענון האחרון; אם מנותק — לא "מרענן" (אין מה), אלא מפעיל `hermesClient.waitForConnection({timeoutMs: 5_000})` ואם חזר — `refreshAll()`.
6. **Backstop** (אנטי-סערה): כשהשער `change_events=true` — טיימר בטיחות אחד כל **5 דקות** (כמו `CRON_BACKSTOP_INTERVAL_MS`); כשהשער `false` (backend ישן) — **60s** לכל ה-slices (שמרני יותר מה-30s/10s הרשמיים; התכל'ס אינו TUI חי). ה-backstop בטל כשהחיבור סגור — אסור לירות fetches לתוך חיבור מת.
7. **Demo / bridge-missing**: `hermesClient.demo` ⇒ freshness `live` קבוע ואין מנויים (אין סוקט, אין מה לזייף); `bridgeMissing` ⇒ `stale(disconnected)` קבוע.

### 5.4 החיווט: `src/lib/server-state-wiring.ts` (חדש, דק)
מודול אתחול יחיד (נקרא פעם אחת מ-`App.tsx` או מ-hook הבעלים):
- `hermesClient.onEvent(e => { const cap = readChangeEventsCapability(e); if (cap !== null) store.setChangeEvents(cap); for (const s of routeChangeEvent(e)) store.invalidate(s) })`
- `hermesClient.onConnectionChange(state => store.connectionChanged(state))`
- `window.addEventListener('focus', ...)` + `document.addEventListener('visibilitychange', ...)` (רענון רק במעבר ל-visible).

### 5.5 ה-hook הציבורי: `src/hooks/useServerState.ts` (חדש) — החוזה ל-partner-feed

```ts
import type { ServerStateSlice, SliceStatus } from '../lib/server-state'

/**
 * מנוי ל-slice של מצב-שרת חי. הנתונים עצמם ממשיכים לגור אצל הבעלים
 * (useHermesData / hooks ייעודיים); ה-hook הזה מחזיר את חוזה הטריות
 * ואת ידית הרענון, כדי שכל צרכן (כולל partner-feed) יציג staleness כן.
 */
export function useServerState(slice: ServerStateSlice): {
  status: SliceStatus                       // freshness + lastSyncedAt + refreshing
  refresh: () => Promise<void>              // רענון ידני, serialized (חוק 2 ב-§5.3)
}

/** מצב-העל לחיווי גלובלי: 'connected' | 'reconnecting' | 'disconnected' + since */
export function useConnectionStatus(): {
  state: 'connected' | 'reconnecting' | 'disconnected'
  since: number | null
}
```

`useHermesData` (פאזה 3) מפורק ל-fetchers פר-slice (אותן קריאות בדיוק, כולל דוקטרינת ה-`loadErrors` הקיימת) שנרשמים ל-store; `refresh()` המונוליטי נשאר לתאימות (boot/install) וממומש כ-`refreshAll`.

### 5.6 חוזה ה-UI ל-staleness
- **חיווי גלובלי**: בכותרת (full shell) ובאזור ה-runtime של `MiniShell` — שלושה מצבים: מחובר (ללא רעש), `מתחבר מחדש…` (בצהוב, מ-`reconnecting`), `מנותק — הנתונים אינם מעודכנים` (אדום + כפתור "רענן עכשיו" שמפעיל `waitForConnection`+`refreshAll`).
- **פר-רשימה**: מסכי המשימות/חיבורים/עזרה מציגים כיתוב `עודכן לאחרונה HH:MM` כש-freshness=stale, על בסיס `lastSyncedAt`. רשימה שמעולם לא נטענה (`unknown`) מציגה את מצב הטעינה/שגיאה הקיים — לא רשימה ריקה.
- `aria-live="polite"` על שינוי מצב החיבור (עקבי עם דפוסי ה-a11y בריפו).

---

## 6. חוזה IPC

**פאזות 1–5: אפס שינוי ב-IPC.** אין ערוץ חדש, אין route חדש ב-`ALLOWED_API_ROUTES` (`ipc-guards.cjs:89-101`) — כל ה-fetchers משתמשים ב-endpoints וב-RPC שכבר מאושרים. זו תוצאה ישירה של ההכרעה ב-§4, והיא יתרון: ה-lockstep הקיים (`ipc-guards.test.ts` סורק את `src/` לליטרלים של `/api/...`) ממשיך לכסות בלי תוספת.

**פאזה 6 (אופציונלית, לא חוסמת): ערוץ push של runtime-state.**
אם partner-feed או ה-UI יזדקקו לשינויי `runtimeState` בזמן-אמת (למשל `running:false` כשה-process מת, לפני שהטרנספורט מזהה):
- **ערוץ**: `hermes:runtime-state` — **main→renderer בלבד** (`webContents.send`), ללא ארגומנטים מה-renderer ⇒ אין קלט לחיטוי; בכל זאת ה-payload עובר דרך אותו מסלול `patchRuntimeState` יחיד (`runtime-state.cjs:46-54`) שכבר רושם שגיאות ל-error-journal.
- **מימוש**: hook יחיד בתוך `patchRuntimeState` שקורא ל-notifier מוזרק (ללא require של Electron במודול — נשאר unit-testable), ו-`main.cjs` מחבר אותו ל-`getMainWindow().webContents.send`.
- **preload**: `onRuntimeState: callback => { const l = (_e, s) => callback(s); ipcRenderer.on('hermes:runtime-state', l); return () => ipcRenderer.removeListener('hermes:runtime-state', l) }` — העתק מדויק של תבנית `onRuntimeLog` (`preload.cjs:86-90`), inline בלבד (sandbox!).
- **בדיקות lockstep**: הרחבת `preload.test.ts` (מנוי+הסרה, כמו שורות 179-191); בדיקת מקור ב-`runtime-state` שה-notifier נקרא על כל patch.

---

## 7. סמנטיקת כשל (fail-closed) — טבלת אמת

| מצב | מה קורה | מה ה-UI מציג |
|---|---|---|
| WS נסגר (gateway נפל/הופעל מחדש) | transport ⇒ `'closed'` ⇒ כל ה-slices `stale(disconnected)`; backstop מושבת | "מנותק — הנתונים אינם מעודכנים" + `עודכן לאחרונה` |
| reconnect מוצלח | tracker מזהה open-אחרי-נפילה ⇒ `refreshAll()`; freshness חוזר ל-live רק **אחרי** קריאות שהצליחו | החיווי נעלם רק אחרי רענון מוצלח בפועל |
| `gateway.ready` בלי `change_events` (backend ישן/עתידי) | שער `false` ⇒ `degraded`, backstop 60s | ללא חיווי מפחיד; רשימות עדיין מתעדכנות |
| fetcher של slice נכשל אחרי אירוע | `stale(load-failed)` + `loadErrors` הקיים | הרשימה הקודמת נשארת אך מסומנת; לא "רשימה ריקה בריאה" |
| boot נכשל (הסוקט מעולם לא נפתח) | transport לא armed ⇒ אין ריטריי-לופ (חוזה קיים, `transport.ts:62-65`); freshness `unknown` | מסך השגיאה/התקנה הקיים |
| demo | אין סוקט; freshness `live` קבוע | ללא חיווי (משטח fixture מוצהר) |
| bridge חסר | `stale(disconnected)` קבוע | הודעת הגשר הקיימת |
| burst של `sessions.changed` בזמן turn סטרימינג | floor שרת 2s + coalesce לקוח 10s trailing-edge | אין סערת קריאות; העדכון האחרון נוחת |

---

## 8. תכנית בדיקות

**Renderer (vitest, קיים):**
1. `src/lib/live-refresh.test.ts` — מיפוי אירוע→slices לכל אירוע מוכר; אירוע לא מוכר ⇒ `[]`; חילוץ `change_events` (true/false/חסר ⇒ fail-closed false).
2. `src/lib/server-state.test.ts` — עם `ManualClock` הקיים (`fake-websocket.ts`): coalesce trailing-edge; in-flight יחיד; stale-on-disconnect מיידי; live רק אחרי הצלחה; focus min-gap; backstop כבוי בניתוק; reconnect ⇒ refreshAll פעם אחת בדיוק (לא על ה-open הראשון).
3. **אינטגרציה עם FakeWebSocket**: תרחיש מלא — connect ⇒ `gateway.ready(change_events:true)` ⇒ `cron.changed` ⇒ fetcher נקרא פעם אחת; ניתוק ⇒ staleness; reconnect ⇒ refreshAll (בסגנון `hermes-client.test.ts` הקיים).
4. **בדיקת lockstep על אוצר-המילים**: מודול יחיד מייצא את רשימת סוגי האירועים הנצרכים; הבדיקה מאמתת ש-`chat-events.ts` ו-`live-refresh.ts` אינם חופפים (אירוע צ'אט לא מנותב לרענון וההפך) ושכל אירוע ב-`CHANGE_EVENT_SLICES` שייך לאוצר המתועד `{cron,sessions,platforms,pairing,pet,skin}.changed ∪ gateway.ready` — ברוח `constants-lockstep.test.ts`.
5. בדיקות UI-contract לחיווי (בסגנון `business-shell-ui-contract.test.ts`): מצב stale מרנדר את המחרוזת ואת `lastSyncedAt`.

**Main (vitest, רק אם פאזה 6):** ראו §6.

**ידני (acceptance):** הרג `hermes` process ⇒ חיווי מנותק בתוך שניות; החייאה ⇒ הרשימות מתעדכנות בלי מגע; יצירת cron מ-Hermes המלא ⇒ מופיע בתכל'ס תוך ~2s; מזעור לשעה וחזרה ⇒ רענון על focus.

---

## 9. סיכונים

| סיכון | חומרה | מיטיגציה |
|---|---|---|
| שדרוג Hermes משנה/מסיר את אירועי ה-changed (הם undocumented API פנימי) | בינונית | שער `change_events` הוא בדיוק ההגנה הרשמית: היעדרו ⇒ `degraded` + backstop; שום דבר לא נשבר. עדכון `hermes-compat.json` בעת עליית גרסה |
| `sessions.changed` יורה על כל כתיבת state.db (גם streams) | בינונית | floor שרת 2s + coalesce לקוח 10s + `session.list` זול (limit 100) |
| double-refresh: mutation מקומית (למשל יצירת משימה) גוררת גם `onRefresh` ידני וגם `cron.changed` | נמוכה | ה-coalesce + in-flight-dedupe הופכים את זה לקריאה אחת נוספת לכל היותר |
| focus storms (מעבר חלונות מהיר) | נמוכה | `focusMinGapMs=15s` |
| ה-store ברמת module דולף בין טסטים | נמוכה | `createServerStateStore` factory + singleton דק, כמו `HermesClient` |
| חיווי staleness מפחיד בזמן restart יזום (update flow) | נמוכה | `useSupportActions.onRestart` כבר עוטף ב-`waitForConnection`; החיווי מציג "מתחבר מחדש…" ולא "מנותק" בזמן `reconnecting` |

---

## 10. פאזות מימוש (כל פאזה = subagent אחד ברמת Sonnet)

**פאזה 1 — אוצר האירועים והניתוב (טהור).**
קבצים: `src/lib/live-refresh.ts` (חדש), `src/lib/live-refresh.test.ts` (חדש).
קבלה: `routeChangeEvent`/`readChangeEventsCapability` ממומשים ונבדקים כולל fail-closed; בדיקת lockstep מול אוצר `chat-events`; `npx vitest run src/lib/live-refresh.test.ts` ירוק; אפס שינוי בקבצים קיימים.

**פאזה 2 — server-state store (טהור, timers מוזרקים).**
קבצים: `src/lib/server-state.ts` (חדש) + `src/lib/server-state.test.ts` (חדש).
קבלה: כל שבעת החוקים ב-§5.3 מכוסים בטסט (כולל: stale מיידי בניתוק, live רק אחרי הצלחה, coalesce trailing-edge, in-flight יחיד, backstop כבוי בניתוק); ללא תלות ב-React וב-hermesClient (הזרקות בלבד).

**פאזה 3 — חיווט לאפליקציה.**
קבצים: `src/lib/server-state-wiring.ts` (חדש), `src/hooks/useHermesData.ts` (פירוק ל-fetchers פר-slice ורישום ל-store; `refresh()` נשמר כ-`refreshAll`), `src/App.tsx` (אתחול wiring), `src/hooks/useServerState.ts` (חדש — החתימה ב-§5.5).
קבלה: התנהגות boot/onboarding ללא שינוי (הטסטים הקיימים ירוקים); תרחיש האינטגרציה מ-§8.3 עובר; `useServerState('schedule')` מחזיר freshness חי בפועל.

**פאזה 4 — focus + backstop.**
קבצים: `server-state-wiring.ts`, `server-state.ts` (טיימרים).
קבלה: focus/visibilitychange מרעננים עם min-gap; backstop 5min/60s לפי השער; טסטים עם ManualClock; מדגם ידני שאין קריאות רשת בזמן ניתוק (בדיקה מול `recentLogs`).

**פאזה 5 — חיווי staleness ב-UI.**
קבצים: `src/components/layout/*` (הכותרת), `src/components/MiniShell.tsx`, מסכי הרשימות; CSS בהתאם לדפוסי הריפו.
קבלה: שלושת מצבי החיווי + `עודכן לאחרונה` + כפתור רענון ידני; `aria-live`; בדיקות UI-contract; עברית-RTL תקינה.

**פאזה 6 (אופציונלית) — `hermes:runtime-state` push.**
קבצים: `electron/runtime-state.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `electron/preload.test.ts`, `src/vite-env.d.ts`.
קבלה: notifier מוזרק (ללא Electron ב-runtime-state); בדיקות preload lockstep; ה-renderer מקבל `running:false` בלי לקרוא `getRuntime`.

---

## נספח: קבצים קריטיים למימוש
- `src/lib/hermes/transport.ts` — הטרנספורט הקיים: onEvent / onConnectionChange / reconnect שהכול נשען עליהם
- `src/lib/hermes-client.ts` — ה-facade היחיד; נקודת החיבור של ה-wiring
- `src/hooks/useHermesData.ts` — הבעלים של ה-slices; מפורק ל-fetchers בפאזה 3
- `src/lib/hermes/chat-resume.ts` — ה-tracker לזיהוי open-אחרי-נפילה (שימוש חוזר)
- `%LOCALAPPDATA%\hermes\hermes-agent\tui_gateway\server.py` — מקור האמת לאירועי `*.changed` (שורות 3129-3201, 1359-1413)

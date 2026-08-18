// GENERATED FILE — do not edit by hand.
// Source: hermes-plugin/business-shell/src/*  ·  Builder: scripts/build-plugin.mjs
// Run `npm run build:plugin` after changing the src modules. Verified by
// `npm run verify:plugin` (stale-artifact check) and src/lib/plugin-source.test.ts.
// Hermes Desktop loads this single file and compiles it without JSX, so every
// element is built with React.createElement and only 'react' and
// '@hermes/plugin-sdk' may be imported.
import { host, StatusDot, Badge, Textarea, Input, Loader, useValue, evaluateRuntimeReadiness, Button, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import React, { useState, useEffect, useMemo } from 'react'

// Hermes compiles the shipped plugin without JSX, so every element is built with
// React.createElement. `h` is the shared shorthand used across the shell modules.
const h = React.createElement;

// Canonical cron/once → Hebrew DISPLAY core, shared by the React app's friendly
// schedule picker (src/lib/schedule.ts, which additionally owns FORM compilation —
// UI state → cron string — that the plugin never needs) and the Rollup-bundled
// Hermes Desktop plugin (hermes-plugin/business-shell/src/helpers.js), which only
// ever holds a raw stored schedule string (job.schedule_display/schedule/cron).
//
// This module knows nothing about the daily/weekly/once/advanced picker UI state —
// only how to turn a Hermes schedule STRING into Hebrew display text, and the small
// day-list building blocks both sides need. schedule.ts wraps this for its friendly
// model and round-trips describeSchedule() through compileSchedule() + this core so
// the two can never drift apart again (see schedule.ts for that wiring). Before this
// module existed, the plugin's own <select> presets and describeSchedule copy were a
// hand-duplicated 3-entry lookup (hermes-plugin/business-shell/src/helpers.js) that
// only coincidentally matched the React side and silently fell back to raw cron for
// anything else (e.g. a 4th preset, or an arbitrary weekday combination).

// 0=Sunday … 6=Saturday, matching cron's day-of-week numbering (0=Sun).
const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
// The Israeli work week is Sunday–Thursday.
const ISRAELI_WORK_WEEK = [0, 1, 2, 3, 4];

// A bare local once-timestamp — NO seconds, NO offset/Z — is the only "simple" once
// form the friendly picker understands. Anything carrying seconds or an offset is a
// precise instant that must never be reinterpreted as local, so callers keep it
// verbatim (see schedule.ts's parseSchedule for the friendly-model side of this).
const SIMPLE_ONCE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

function pad(value) {
  return String(value).padStart(2, '0')
}

// Collapse a sorted day list into a compact cron field: contiguous runs become
// ranges (0,1,2,3,4 → "0-4"), the rest stay comma-separated (0,3 → "0,3").
function compressDays(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i += 1) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue
    }
    parts.push(start === prev ? `${start}` : start + 1 === prev ? `${start},${prev}` : `${start}-${prev}`);
    start = sorted[i];
    prev = sorted[i];
  }
  return parts.join(',')
}

// Inverse of compressDays: expand a cron day-of-week field (possibly containing
// ranges and/or a comma list) back into a sorted, deduped day-number array. Returns
// [] for anything it cannot confidently parse, so callers fall back honestly.
function expandDays(field) {
  const out = [];
  for (const chunk of field.split(',')) {
    const range = chunk.match(/^(\d)-(\d)$/);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d += 1) out.push(d % 7);
    } else if (/^\d$/.test(chunk)) {
      out.push(Number(chunk) % 7);
    } else {
      return []
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

// Human Hebrew phrasing for a day-number list, with the two common cases named
// specially (the Israeli work week, and every day) and day-range compression for
// everything else — e.g. [0,1,2,3,4] → "ימים א׳–ה׳", [0,3] → "ימים א׳, ד׳".
function describeDays(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.join(',') === ISRAELI_WORK_WEEK.join(',')) return 'ימים א׳–ה׳'
  if (sorted.join(',') === '0,1,2,3,4,5,6') return 'כל יום'
  return `ימים ${sorted.map(day => DAY_LABELS[day]).join(', ')}`
}

// Turn a raw Hermes schedule string (5-field cron, or a bare local once ISO
// timestamp) into a Hebrew description. Anything not confidently recognised is
// returned TRIMMED but otherwise VERBATIM — never dropped, never "[object
// Object]" — so an already-human display string, an interval expression, an
// offset/seconds-bearing once, or a genuinely unusual cron field all round-trip
// safely instead of throwing away information. An empty/blank input returns ''; the
// caller decides what "no schedule" copy to show (the plugin and the React side use
// different fallback text there).
function humanizeSchedule(schedule) {
  const value = String(schedule || '').trim();
  if (!value) return ''
  const simpleOnce = value.match(SIMPLE_ONCE_PATTERN);
  if (simpleOnce) {
    const [, date, time] = simpleOnce;
    const [y, m, d] = date.split('-');
    return `פעם אחת ב־${d}/${m}/${y} בשעה ${time}`
  }
  const parts = value.split(/\s+/);
  if (parts.length === 5 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
    const [minute, hour, dom, month, dow] = parts;
    const time = `${pad(hour)}:${pad(minute)}`;
    if (dom === '*' && month === '*') {
      if (dow === '*') return `כל יום בשעה ${time}`
      const days = expandDays(dow);
      if (days.length) return `${describeDays(days)} בשעה ${time}`
    }
  }
  return value
}

// Common quick-create presets. One array — add a fourth preset here and BOTH the
// plugin's <select> (hermes-plugin/business-shell/src/screens/automation-form.js)
// and any future React quick-create surface render it correctly, with the label
// always derived from humanizeSchedule() so it can never drift out of the
// coincidental hand-matched sync that used to require touching two files.
const SCHEDULE_PRESET_VALUES = ['0 8 * * 0-4', '0 9 * * *', '0 9 * * 0'];

// Pinned cross-runtime contract cases. src/lib/schedule.test.ts and
// hermes-plugin/business-shell/src/schedule-display.test.js both run every case
// through their own call path down into this same humanizeSchedule(), so a drift on
// either side fails a focused test instead of silently rendering raw cron.
const SCHEDULE_DISPLAY_CASES = [
  { label: 'Israeli work week', schedule: '0 8 * * 0-4', text: 'ימים א׳–ה׳ בשעה 08:00' },
  { label: 'every day', schedule: '0 9 * * *', text: 'כל יום בשעה 09:00' },
  { label: 'single weekday (Sunday)', schedule: '0 9 * * 0', text: 'ימים א׳ בשעה 09:00' },
  { label: 'single weekday (Thursday)', schedule: '0 16 * * 4', text: 'ימים ה׳ בשעה 16:00' },
  { label: 'arbitrary day list', schedule: '30 9 * * 0,3', text: 'ימים א׳, ד׳ בשעה 09:30' },
  { label: 'contiguous but non-work-week range (no extra compression beyond the two named sets)', schedule: '0 9 * * 1-3', text: 'ימים ב׳, ג׳, ד׳ בשעה 09:00' },
  { label: 'every day spelled out as 0-6', schedule: '0 7 * * 0-6', text: 'כל יום בשעה 07:00' },
  { label: 'simple local once', schedule: '2026-08-05T09:00', text: 'פעם אחת ב־05/08/2026 בשעה 09:00' },
  { label: 'offset-bearing once falls back verbatim', schedule: '2026-08-05T09:00:00+03:00', text: '2026-08-05T09:00:00+03:00' },
  { label: 'seconds-bearing once falls back verbatim', schedule: '2026-08-05T09:00:30', text: '2026-08-05T09:00:30' },
  { label: 'interval expression falls back verbatim', schedule: 'every 30m', text: 'every 30m' },
  { label: 'already-human text round-trips', schedule: 'כל יום בשעה 09:00', text: 'כל יום בשעה 09:00' },
  { label: 'empty string', schedule: '', text: '' }
];

// Canonical tool-name/action → Hebrew activity-label rules. src/lib/presentation.ts
// (React app) receives rich agent tool-call payloads (name + action + a command
// buried in various argument shapes) and extracts (name, action, command) itself —
// see toolArguments()/humanizeTool() there — before calling describeTool() below.
// The Rollup-bundled Hermes Desktop plugin's activity strip
// (hermes-plugin/business-shell/src/screens/activity-strip.js) only ever has a bare
// tool NAME off a socket event, so it calls the same describeTool() with no
// action/command and gets the category's honest default text. One rule table either
// way — this used to be TWO: presentation.ts's ~50 action-aware rules and
// helpers.js's own 8-substring TOOL_COPY dict, with no shared code and no test tying
// them together.
//
// describeTool() returns null when nothing matches; each caller supplies its own
// final fallback copy (they differ on purpose — the plugin shows a lightweight
// in-progress ellipsis, the React app shows a labeled generic-tool line).

function terminalActivity(command) {
  const text = String(command || '');
  if (/\b(?:npm|pnpm|yarn|vitest|jest|pytest)\b[^\r\n]*(?:test|check)/i.test(text)) return 'מריץ בדיקות'
  if (/\bgit\s+(?:status|diff|log|show)\b/i.test(text)) return 'בודק את שינויי הקוד'
  if (/\bgit\s+(?:add|commit|push|pull|merge|rebase)\b/i.test(text)) return 'מעדכן את מאגר הקוד'
  if (/\b(?:rg|grep|findstr|select-string)\b/i.test(text)) return 'מחפש בקבצי המחשב'
  if (/\b(?:gmail|google|calendar|drive)\b/i.test(text)) return 'בודק נתוני Google דרך המחשב'
  if (/\b(?:python|python3|py)\b/i.test(text)) return 'מריץ סקריפט Python'
  if (/\b(?:powershell|pwsh)\b/i.test(text)) return 'מריץ פקודת PowerShell'
  return 'מריץ פקודת מערכת'
}

// Ordered category rules. `test` matches the lower-cased tool name; `actions` is an
// ordered list of { test, text } matched against the lower-cased action string
// (first match wins); `fallback` is used when no action rule matches, or when the
// caller has no action at all. The 'terminal' category is special-cased: its
// activity depends on the shell COMMAND, not an action verb.
const CATEGORY_RULES = [
  {
    category: 'calendar',
    test: /google.*calendar|calendar/,
    actions: [
      { test: /create|add|schedule/, text: 'יוצר אירוע ביומן' },
      { test: /update|edit|move|reschedule/, text: 'מעדכן אירוע ביומן' },
      { test: /delete|remove|cancel/, text: 'מסיר אירוע מהיומן' }
    ],
    fallback: 'בודק אירועים ביומן'
  },
  {
    category: 'gmail',
    test: /gmail|email|mail/,
    actions: [
      { test: /send/, text: 'שולח אימייל' },
      { test: /draft|compose|create/, text: 'מכין טיוטת אימייל' },
      { test: /search|list|find|query/, text: 'מחפש הודעות ב־Gmail' },
      { test: /read|get|open/, text: 'קורא הודעה ב־Gmail' }
    ],
    fallback: 'בודק את Gmail'
  },
  {
    category: 'drive',
    test: /drive|docs|sheets/,
    actions: [
      { test: /search|list|find/, text: 'מחפש מסמכים ב־Google Drive' },
      { test: /write|create|update|edit/, text: 'מעדכן מסמך ב־Google Drive' }
    ],
    fallback: 'קורא מסמך מ־Google Drive'
  },
  { category: 'web_search', test: /web_search|search_web/, actions: [], fallback: 'מחפש מידע באינטרנט' },
  { category: 'web_extract', test: /web_extract|fetch|scrape/, actions: [], fallback: 'קורא מקור מהאינטרנט' },
  {
    category: 'browser',
    test: /browser|computer|screenshot|click|navigate/,
    actions: [
      { test: /screenshot|capture/, text: 'מצלם את המסך לבדיקה' },
      { test: /click|press|select/, text: 'מפעיל פקד בממשק' },
      { test: /type|fill|input/, text: 'ממלא פרטים בממשק' },
      { test: /open|navigate|goto/, text: 'פותח עמוד בדפדפן' }
    ],
    fallback: 'בודק את הממשק בדפדפן'
  },
  { category: 'terminal', test: /terminal|shell|process|command/, actions: [], fallback: null },
  { category: 'cron', test: /cron|schedule/, actions: [], fallback: 'מעדכן משימה מתוזמנת' },
  { category: 'skill', test: /skill/, actions: [], fallback: 'מפעיל תהליך עבודה שמור' },
  { category: 'memory', test: /memory/, actions: [], fallback: 'בודק פרטים מהזיכרון' },
  { category: 'todo', test: /todo|task/, actions: [], fallback: 'מעדכן את רשימת המשימות' },
  { category: 'file_read', test: /read.*file|file.*read/, actions: [], fallback: 'קורא קובץ מהמחשב' },
  { category: 'file_write', test: /write.*file|edit.*file|file.*write/, actions: [], fallback: 'מעדכן קובץ במחשב' }
];

// name: the full tool name (any case). action/command are optional finer-grained
// hints a richer caller can supply; omit them (the plugin's activity strip always
// does — it only has a bare name) and you still get the category's honest default.
// Returns null only when NO category matches at all — callers decide their own
// final generic-tool fallback copy.
function describeTool(name, action = '', command = '') {
  const normalized = String(name || '').toLowerCase();
  const actionText = String(action || '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (!rule.test.test(normalized)) continue
    if (rule.category === 'terminal') return terminalActivity(command)
    const matched = rule.actions.find(entry => entry.test.test(actionText));
    return matched ? matched.text : rule.fallback
  }
  return null
}

// Pinned cross-runtime contract cases, exercised directly against describeTool()
// (no action-defaulting trickery — every case passes an explicit action/command) by
// both src/lib/presentation.test.ts and
// hermes-plugin/business-shell/src/tool-copy.test.js.
const TOOL_COPY_CASES = [
  { label: 'calendar, no recognised action → category default', name: 'google_calendar.list_events', action: '', command: '', text: 'בודק אירועים ביומן' },
  { label: 'calendar create', name: 'google_calendar', action: 'create', command: '', text: 'יוצר אירוע ביומן' },
  { label: 'calendar delete', name: 'google_calendar', action: 'cancel', command: '', text: 'מסיר אירוע מהיומן' },
  { label: 'gmail send', name: 'gmail.send_message', action: 'send', command: '', text: 'שולח אימייל' },
  { label: 'gmail, no recognised action → category default', name: 'google_workspace.gmail_search', action: '', command: '', text: 'בודק את Gmail' },
  { label: 'drive, no recognised action → category default', name: 'google_drive', action: '', command: '', text: 'קורא מסמך מ־Google Drive' },
  { label: 'drive write', name: 'google_sheets', action: 'update', command: '', text: 'מעדכן מסמך ב־Google Drive' },
  { label: 'web search', name: 'web_search', action: '', command: '', text: 'מחפש מידע באינטרנט' },
  { label: 'web extract', name: 'web_extract', action: '', command: '', text: 'קורא מקור מהאינטרנט' },
  { label: 'browser click', name: 'browser', action: 'click', command: '', text: 'מפעיל פקד בממשק' },
  { label: 'terminal runs tests', name: 'terminal', action: '', command: 'npm test', text: 'מריץ בדיקות' },
  { label: 'terminal git status', name: 'terminal', action: '', command: 'git status', text: 'בודק את שינויי הקוד' },
  { label: 'cron', name: 'cronjob', action: '', command: '', text: 'מעדכן משימה מתוזמנת' },
  { label: 'skill', name: 'skill_manage', action: '', command: '', text: 'מפעיל תהליך עבודה שמור' },
  { label: 'memory', name: 'memory_get', action: '', command: '', text: 'בודק פרטים מהזיכרון' },
  { label: 'todo', name: 'todo_list', action: '', command: '', text: 'מעדכן את רשימת המשימות' },
  { label: 'file read', name: 'read_file', action: '', command: '', text: 'קורא קובץ מהמחשב' },
  { label: 'file write', name: 'write_file', action: '', command: '', text: 'מעדכן קובץ במחשב' },
  { label: 'unrecognised tool → null (caller supplies its own final fallback)', name: 'unknown_internal_tool', action: '', command: '', text: null }
];

// Pure helpers and small hooks shared by the business shell screens. No JSX and
// no side effects at module load — safe for the contract test that evaluates the
// bundled plugin in a bare VM.

// Legacy key: earlier builds shadowed paused cron jobs in plugin storage. That
// store is never trusted again — see purgeLegacyPausedCache below.
const LEGACY_PAUSED_CACHE_KEY = 'pausedCronJobs';

// A short in-progress ellipsis for tool names this shell has its own tighter copy
// for. Anything not listed here falls through to the shared tool-copy classifier
// (../../../shared/tool-copy.js) — the same ~50-rule table src/lib/presentation.ts
// uses — so this went from 8 recognised substrings to full category coverage
// without duplicating a single rule.
const TOOL_COPY = {
  google_calendar: 'בודק את היומן…',
  google_drive: 'מחפש ב־Drive…',
  gmail: 'עובד עם המייל…',
  skills_list: 'בודק תהליכים שנלמדו…',
  skill_manage: 'לומד את התהליך…',
  cronjob: 'מעדכן משימה מתוזמנת…',
  browser: 'פותח את הדפדפן…',
  terminal: 'מבצע פעולה במחשב…'
};

function friendlyToolName(raw) {
  const name = String(raw || '').toLowerCase();
  const key = Object.keys(TOOL_COPY).find(candidate => name.includes(candidate));
  if (key) return TOOL_COPY[key]
  // The activity strip only ever has a bare tool name (no action/command), so this
  // resolves to the shared classifier's category default text.
  const described = describeTool(name);
  return described || 'מבצע פעולה…'
}

function humanSchedule(raw) {
  // Accept either the official human string (schedule_display) or the structured
  // schedule dict. For a dict we pull a known display/expr field — never String()
  // the object, which would render "[object Object]"; an unknown shape degrades to
  // the Hermes-schedule fallback below.
  const schedule =
    raw && typeof raw === 'object'
      ? String(raw.schedule_display || raw.display || raw.expr || raw.cron || raw.value || '')
      : String(raw || '');
  if (!schedule) return 'לפי לוח הזמנים של Hermes'
  // Full cron→Hebrew fidelity (day-range compression, single/arbitrary weekdays,
  // once-schedules) from the same core src/lib/schedule.ts uses — not just the
  // three cron strings the quick-create presets happen to offer. An already-human
  // string, or anything genuinely unrecognised, round-trips through unchanged.
  return humanizeSchedule(schedule)
}

// A job is paused when the OFFICIAL record says so — never a local flag. The
// authoritative schema carries state==='paused'; enabled===false and the legacy
// paused flag are honored too so both doors and older normalizers agree.
function isJobPaused(job) {
  return Boolean(job && (job.state === 'paused' || job.enabled === false || job.paused === true))
}

// Identity for a scheduled-task row across BOTH doors this shell reads: the
// companion backend projects `id`, the fallback active-only cron.manage RPC emits
// `job_id` (== the same id), and both carry a human `name`. cron.manage's
// resolve_job_ref accepts any of them as a mutation key, so prefer the stable id,
// then job_id, then name — one place, no inline `id || job_id || name` scattered.
function cronJobId(job) {
  return (job && (job.id || job.job_id || job.name)) || null
}

// Single source of truth for the scheduled-task list: normalize a cron.manage
// result to { jobs, pausedListingSupported }. In Hermes 0.19.x the gateway RPC
// door (cronjob action:'list' -> list_jobs(include_disabled=False)) is
// active-only, so pausedListingSupported is true only if the surface itself
// returned a paused job. That lets a future paused-inclusive Hermes render them
// inline, while today's active-only door is reported honestly (no cache).
function summarizeCronJobs(result) {
  const jobs = Array.isArray(result?.jobs) ? result.jobs : Array.isArray(result) ? result : [];
  return { jobs, pausedListingSupported: jobs.some(isJobPaused) }
}

// One-time, non-authoritative cleanup of the legacy paused-task cache, confined
// to plugin storage. Returns how many stale rows were dropped. The value is
// never read back as truth — pause/resume state lives only in official Hermes.
function purgeLegacyPausedCache(storage) {
  const legacy = storage.get(LEGACY_PAUSED_CACHE_KEY, null);
  if (legacy == null) return 0
  if (typeof storage.remove === 'function') storage.remove(LEGACY_PAUSED_CACHE_KEY);
  else storage.set(LEGACY_PAUSED_CACHE_KEY, null);
  return Array.isArray(legacy) ? legacy.length : 0
}

function flattenSkillNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap(flattenSkillNames)
  }

  if (value && typeof value === 'object') {
    if (typeof value.name === 'string') {
      return [value.name]
    }

    return Object.values(value).flatMap(flattenSkillNames)
  }

  return typeof value === 'string' ? [value] : []
}

function useAsync(load, deps) {
  const [state, setState] = useState({ loading: true, value: null, error: null });

  useEffect(() => {
    let live = true;
    setState(current => ({ ...current, loading: true, error: null }));
    Promise.resolve()
      .then(load)
      .then(value => live && setState({ loading: false, value, error: null }))
      .catch(error => live && setState({ loading: false, value: null, error }));
    return () => {
      live = false;
    }
  }, deps);

  return state
}

// Pure, dependency-free normalization for the scheduled-task backend payload.
// Kept out of cron-source.js (which imports the runtime-only @hermes/plugin-sdk)
// so the degrade/fallback decision is unit-testable in a bare VM.

// Extract the jobs array from a backend payload, or null when the payload is
// malformed (not an object/array, or missing a `jobs` array). Returning null —
// rather than [] — lets the caller DEGRADE to the active-only door instead of
// silently claiming paused-inclusive support over an empty/garbage response.
function extractJobs(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.jobs)) return payload.jobs
  return null
}

// Decide whether a companion-backend payload can be TRUSTED as the paused-
// inclusive source. Returns { jobs, pausedListingSupported: true } on a well-
// formed, non-degraded body with a real jobs array (possibly empty), or null to
// signal "degrade to the active-only cron.manage door". Degrades on:
//   - null / non-object-or-array payload
//   - an explicit degraded:true or paused_listing_supported:false body
//   - a payload with no `jobs` array (missing/garbage flag or shape)
function resolveBackendPayload(payload) {
  const explicitlyDegraded =
    payload == null ||
    (typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload.degraded === true || payload.paused_listing_supported === false));
  if (explicitlyDegraded) return null
  const jobs = extractJobs(payload);
  if (!jobs) return null
  return { jobs, pausedListingSupported: true }
}

// Single source of truth for the scheduled-task LIST, active + paused.
//
// The desktop PluginContext hands each plugin a `rest(path)` door that is
// namespace-locked BY CONSTRUCTION to that plugin's own backend at
// /api/plugins/<id> (Hermes apps/desktop/src/contrib/plugin.ts::PluginContext
// -> hermes.ts::pluginRest: it rejects '..' and cannot address a core route or
// another plugin's namespace). Our companion backend
// (hermes-plugin/business-shell/dashboard/plugin_api.py) answers `/cron/jobs`
// by calling Hermes' authoritative scheduler `list_jobs(include_disabled=True)`
// — the SAME store the core /api/cron/jobs route reads. So this door is a
// paused-inclusive view of the one official scheduler: no parallel store, no
// cache. Mutations stay official scheduler operations on the cron.manage RPC.
const PLUGIN_BACKEND_NAMESPACE = '/api/plugins/business-shell';

let pluginRest = null;

// The plugin's `register(ctx)` installs the real namespace-scoped door here.
// Kept module-local (like the imported `host`) so the screens don't need `ctx`
// threaded through every prop. A non-function (older SDK, missing door) simply
// disables the paused-inclusive path and we fall back honestly.
function setPluginRest(rest) {
  pluginRest = typeof rest === 'function' ? rest : null;
}

function hasPausedInclusiveDoor() {
  return typeof pluginRest === 'function'
}

// Load scheduled tasks with capability detection.
//   Preferred: the companion backend door (paused-inclusive, authoritative).
//   Fallback:  the active-only cron.manage gateway RPC — used when the backend
//              is unavailable (older Hermes, the companion plugin not
//              installed/enabled, an OAuth remote where ctx.rest is a no-op, or
//              any transport error).
// Both doors read live official Hermes state; neither is a cache. Returns
// { jobs, pausedListingSupported, source } so the UI can render paused rows
// inline when supported and degrade honestly when not.
async function loadScheduledTasks() {
  if (pluginRest) {
    try {
      const payload = await pluginRest('/cron/jobs');
      // resolveBackendPayload returns null (degrade) on a null/malformed/non-array/
      // missing-flag or explicitly-degraded body, so the UI falls back to the
      // active-only door and shows its honest notice instead of hiding a fallback
      // behind an empty list. Only a well-formed non-degraded body is trusted.
      const resolved = resolveBackendPayload(payload);
      if (resolved) {
        return { ...resolved, source: 'plugin-backend' }
      }
    } catch {
      // fall through to the active-only gateway door
    }
  }
  const viaRpc = await host.request('cron.manage', { action: 'list' });
  return { ...summarizeCronJobs(viaRpc), source: 'cron.manage' }
}

// Reusable presentational primitives shared by every screen. Tailwind-in-string
// classes mirror the Hermes design tokens so the shell matches the host UI.

function SectionTitle({ eyebrow, title, copy }) {
  return h(
    'div',
    { className: 'mb-4' },
    eyebrow
      ? h('div', { className: 'mb-1 text-[0.6875rem] font-semibold tracking-wide text-primary' }, eyebrow)
      : null,
    h('h2', { className: 'text-lg font-semibold text-(--ui-text-primary)' }, title),
    copy ? h('p', { className: 'mt-1 max-w-2xl text-xs leading-5 text-(--ui-text-tertiary)' }, copy) : null
  )
}

function Card({ children, className = '' }) {
  return h(
    'section',
    {
      className: `rounded-[6px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 ${className}`
    },
    children
  )
}

function Metric({ label, value, tone = 'good' }) {
  return h(
    'div',
    { className: 'flex min-w-0 items-center gap-2' },
    h(StatusDot, { tone }),
    h(
      'div',
      { className: 'min-w-0' },
      h('div', { className: 'truncate text-xs font-medium text-(--ui-text-primary)' }, value),
      h('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)' }, label)
    )
  )
}

function QuickAction({ icon, title, copy, onClick, badge }) {
  return h(
    'button',
    {
      type: 'button',
      onClick,
      className:
        'group flex min-h-28 flex-col items-start rounded-[6px] border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 text-right transition-colors hover:bg-(--ui-bg-tertiary)'
    },
    h(
      'div',
      { className: 'mb-3 flex w-full items-start justify-between gap-2' },
      h('span', { className: 'text-xl', 'aria-hidden': true }, icon),
      badge ? h(Badge, { variant: 'muted' }, badge) : null
    ),
    h('strong', { className: 'text-sm text-(--ui-text-primary)' }, title),
    h('span', { className: 'mt-1 text-xs leading-5 text-(--ui-text-tertiary)' }, copy)
  )
}

function Field({ label, name, value, onChange, multiline = false, placeholder = '' }) {
  const Component = multiline ? Textarea : Input;
  return h(
    'label',
    { className: 'grid gap-1.5' },
    h('span', { className: 'text-xs font-medium text-(--ui-text-secondary)' }, label),
    h(Component, {
      name,
      value,
      placeholder,
      rows: multiline ? 3 : undefined,
      onChange: event => onChange(name, event.target.value)
    })
  )
}

// Canonical, cross-runtime onboarding data contract. Plain JS so BOTH the React /
// Electron wrapper (typed via onboarding-contract.d.ts) and the Rollup-bundled
// Hermes Desktop plugin consume ONE source — no hand-maintained per-language copy.

const ONBOARDING_FIELD_TEMPLATE = {
  userName: '',
  role: 'בעל/ת העסק',
  language: 'עברית',
  responseStyle: 'קצר, ברור ומעשי',
  workHours: '09:00–18:00',
  approvals: ['שליחת הודעות ומיילים', 'מחיקה או שינוי קבצים', 'התחייבות כספית'],
  timeSavers: '',
  businessName: '',
  industry: '',
  offerings: '',
  customers: '',
  businessHours: '',
  communicationStyle: 'מקצועי, חם ולא מתנשא',
  restrictions: '',
  recurringProcesses: '',
  systems: ''
};

// First run is conversation-led. Keep the complete schema, but do not persist
// suggested values as if the owner had confirmed them. The bootstrap Skill may
// use friendly defaults while speaking; durable business facts start unknown.
const EMPTY_ONBOARDING = {
  ...ONBOARDING_FIELD_TEMPLATE,
  role: '',
  language: '',
  responseStyle: '',
  workHours: '',
  communicationStyle: ''
};

const ONBOARDING_KEYS = Object.keys(EMPTY_ONBOARDING);

// Legacy plugin fallback-form keys → canonical keys, so persisted user data keeps
// working after unification (migration/normalization, never a silent data loss).
const LEGACY_ALIASES = {
  name: 'userName',
  answerStyle: 'responseStyle',
  repetitiveTasks: 'timeSavers',
  openingHours: 'businessHours',
  voice: 'communicationStyle',
  forbiddenPromises: 'restrictions',
  processes: 'recurringProcesses'
};

// One canonical, nontechnical Hebrew questionnaire. Both shells derive their form
// from this so field keys can never drift again.
const ONBOARDING_STEPS = [
  {
    title: 'נעים להכיר',
    copy: 'כמה פרטים שיעזרו לעוזר לעבוד כמו שמתאים לך.',
    fields: [
      { key: 'userName', label: 'שם' },
      { key: 'role', label: 'תפקיד' },
      { key: 'language', label: 'שפה מועדפת' },
      { key: 'responseStyle', label: 'סגנון תשובות' },
      { key: 'workHours', label: 'שעות עבודה' }
    ]
  },
  {
    title: 'העסק',
    copy: 'המידע יישמר ב־Memory וב־Skill של Hermes, לא ב־prompt ענקי.',
    fields: [
      { key: 'businessName', label: 'שם העסק' },
      { key: 'industry', label: 'תחום פעילות' },
      { key: 'offerings', label: 'שירותים ומוצרים', multiline: true },
      { key: 'customers', label: 'סוגי לקוחות' },
      { key: 'businessHours', label: 'שעות פעילות' }
    ]
  },
  {
    title: 'איך נכון לעבוד',
    copy: 'גבולות ברורים ותהליכים שהעוזר יכול לחסוך.',
    fields: [
      { key: 'approvals', label: 'פעולות שדורשות אישור', multiline: true },
      { key: 'communicationStyle', label: 'סגנון התקשורת של העסק', multiline: true },
      { key: 'restrictions', label: 'מגבלות והתחייבויות שאסור לתת', multiline: true },
      { key: 'recurringProcesses', label: 'תהליכים חוזרים', multiline: true },
      { key: 'systems', label: 'מערכות וקבצים בשימוש', multiline: true },
      { key: 'timeSavers', label: 'משימות שתרצה לחסוך', multiline: true }
    ]
  }
];

// Shared persistence keys so the simple shell and full Hermes agree on state.
const STORAGE_KEYS = {
  complete: 'hermes-business-onboarding-v1',
  form: 'onboarding',
  guided: 'guidedSetup',
  pluginComplete: 'onboardingComplete'
};

function toList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean)
  return []
}

// Normalize any persisted/partial shape (React form, legacy plugin form) into the
// one canonical contract, preserving every value the user already gave us.
function normalizeOnboarding(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = { ...EMPTY_ONBOARDING, approvals: [...EMPTY_ONBOARDING.approvals] };
  for (const key of ONBOARDING_KEYS) {
    if (key === 'approvals') continue
    if (source[key] != null && source[key] !== '') out[key] = source[key];
  }
  for (const [legacy, canonical] of Object.entries(LEGACY_ALIASES)) {
    const missing = out[canonical] == null || out[canonical] === '' || out[canonical] === EMPTY_ONBOARDING[canonical];
    if (missing && source[legacy] != null && source[legacy] !== '') out[canonical] = source[legacy];
  }
  const approvals = source.approvals != null ? source.approvals : out.approvals;
  out.approvals = toList(approvals);
  if (out.approvals.length === 0) out.approvals = [...EMPTY_ONBOARDING.approvals];
  return out
}

// Canonical provider readiness. `provider_ready` NEVER means "runtime is running";
// it means a supported provider is actually configured AND usable. We distinguish
// runtime-running, provider-configured, provider-usable and unknown/degraded, and
// fail closed (not ready) whenever we could not verify the truth.

const DISCONNECTED_LABEL = 'לא מחובר';

const API_KEY_PROVIDERS = [
  ['OPENROUTER_API_KEY', 'OpenRouter'],
  ['ANTHROPIC_API_KEY', 'Anthropic'],
  ['GEMINI_API_KEY', 'Gemini'],
  ['OPENAI_API_KEY', 'OpenAI']
];

// Short display names for the engine's OAuth catalog, keyed by stable provider
// id. The catalog's `name` is an ENGINE-facing string that may embed English
// status doctrine (observed live: the `claude-code` entry is named
// "Anthropic OAuth: Required Extra Usage Credits to Use Subscription") — the
// user-facing copy register forbids passing that through, so the label a user
// sees is always a short brand name, never the raw catalog sentence.
const OAUTH_DISPLAY_LABELS = {
  nous: 'Nous',
  'openai-codex': 'Codex',
  anthropic: 'Anthropic',
  'claude-code': 'Claude',
  'minimax-oauth': 'MiniMax',
  'xai-oauth': 'Grok',
  'copilot-acp': 'GitHub Copilot'
};

// Reduce an unknown catalog entry to a short brand-like label: the part before
// the first ':' / '(' qualifier, bounded; when nothing brand-like survives,
// fall back to a generic-but-honest label rather than leaking the raw sentence.
const GENERIC_PROVIDER_LABEL = 'ספק AI';
function sanitizeProviderLabel(provider) {
  if (provider && provider.id && OAUTH_DISPLAY_LABELS[provider.id]) return OAUTH_DISPLAY_LABELS[provider.id]
  const raw = String((provider && provider.name) || '').split(/[:(]/)[0].trim();
  if (raw && raw.length <= 24) return raw
  return GENERIC_PROVIDER_LABEL
}

// AMBIENT credential entries: catalog rows whose logged_in state comes from
// ANOTHER tool's machine-scoped credential store (the engine reads Claude
// Code's ~/.claude/.credentials.json and Copilot's CLI login — outside any
// HERMES_HOME), not from a login the user performed in Hermes. They are real,
// usable credentials — but when the user ALSO logged into a provider through
// Hermes itself (auth.json in the home: e.g. openai-codex auth_mode=chatgpt),
// naming the ambient entry as "the" connection misattributes the active
// provider (observed live: an OpenAI-subscription machine captioned
// "Anthropic … מחובר" because the ambient claude-code row listed first).
const AMBIENT_CREDENTIAL_IDS = new Set(['claude-code', 'copilot-acp']);

// Per official source we return a tri-state, never a boolean: 'positive' (this
// source alone proves a provider), 'negative' (inspected, none), or 'unknown' (we
// did not / could not inspect — the value is null). A failed inspection MUST arrive
// here as null, not as [] / {}, or a false 'unavailable' would look like proof.
function inspectOAuth(oauthProviders) {
  if (oauthProviders == null) return { state: 'unknown', label: null }
  const loggedIn = oauthProviders.filter(provider => provider && provider.status && provider.status.logged_in);
  // Hermes-store logins outrank ambient spillover; within a rank, catalog order.
  const oauth = loggedIn.find(provider => !AMBIENT_CREDENTIAL_IDS.has(provider.id)) || loggedIn[0] || null;
  return oauth ? { state: 'positive', label: sanitizeProviderLabel(oauth) } : { state: 'negative', label: null }
}

function inspectEnv(env) {
  if (env == null) return { state: 'unknown', label: null }
  const apiKey = API_KEY_PROVIDERS.find(([key]) => env[key] && env[key].is_set);
  return apiKey ? { state: 'positive', label: apiKey[1] } : { state: 'negative', label: null }
}

// Provider credentials are proven only via Hermes' own surfaces: a live OAuth
// session, or redacted env metadata that reports a key `is_set` (never its value).
// Positive proof from EITHER source is enough — one source failing never masks the
// other's proof.
function resolveProviderReadiness(oauthProviders, env) {
  const oauth = inspectOAuth(oauthProviders);
  if (oauth.state === 'positive') return { connected: true, label: oauth.label }
  const envSource = inspectEnv(env);
  if (envSource.state === 'positive') return { connected: true, label: envSource.label }
  return { connected: false, label: DISCONNECTED_LABEL }
}

// Full honest status with per-source provenance. Positive proof from either source
// ⇒ configured. With no positive proof: if ANY source failed/uninspected (unknown)
// we stay 'unknown' (we cannot prove absence); only when every supported source was
// successfully inspected AND negative do we claim 'unavailable'. An error or an
// incompatible runtime → degraded → unknown. `provider_sources` surfaces the
// inspection state (never errors/secrets) so the agent knows WHY a state was chosen.
function resolveProviderStatus(input = {}) {
  const { runtime, oauthProviders = null, env = null, error = null } = input;
  const running = Boolean(runtime && runtime.running);
  const degraded = Boolean(error) || Boolean(runtime && runtime.compatible === false);
  const oauth = inspectOAuth(oauthProviders);
  const envSource = inspectEnv(env);
  const proof = oauth.state === 'positive' ? oauth : envSource.state === 'positive' ? envSource : null;
  const configured = Boolean(proof);
  const anyUnknown = oauth.state === 'unknown' || envSource.state === 'unknown';
  const usable = configured && running && !degraded;
  const provider_state = degraded
    ? 'unknown'
    : configured
      ? usable
        ? 'usable'
        : 'configured'
      : anyUnknown
        ? 'unknown'
        : running
          ? 'runtime_only'
          : 'unavailable';
  return {
    provider_ready: usable,
    provider_state,
    provider_label: configured ? proof.label : DISCONNECTED_LABEL,
    runtime_running: running,
    provider_configured: configured,
    provider_usable: usable,
    provider_sources: { oauth: oauth.state, env: envSource.state }
  }
}

// Plugin runtime only exposes a resolved model id (via host.state.model). A present
// model id proves the provider is CONFIGURED, never that the credential is usable —
// only a real round-trip proves that. The wrapper must not claim 'usable' it never
// observed, so provider_ready stays false and the state is 'configured'. This is not
// a false-negative deadlock: the agent-led flow runs inside a live session, and its
// own successful response IS the usability proof (see the bootstrap state semantics).
function resolveModelReadiness(model) {
  const configured = typeof model === 'string' && model.length > 0;
  return {
    provider_ready: false,
    provider_state: configured ? 'configured' : 'unavailable',
    provider_label: configured ? model : DISCONNECTED_LABEL,
    provider_configured: configured
  }
}

// The ONE canonical agent-handoff payload. Both the React/Electron wrapper and the
// Hermes Desktop plugin build the argument dispatched to the first-run Skill from
// here, so the product intent (one concise question at a time, connect official
// integrations, confirm before sensitive actions, no false completion, persist into
// Profile/Memory/Skills — never a giant system prompt) lives in a single place.


// The first conversation after an install, before anything is known about what the
// user wants tachles for. It senses business vs community from the answer and then
// continues into the matching bootstrap Skill.
const WELCOME_COMMAND = 'tachles-welcome';

// The business onboarding conversation. Still dispatched directly whenever the
// business role is already established (e.g. the plugin's fallback questionnaire).
const BOOTSTRAP_COMMAND = 'business-bootstrap';

const LINES = [
  "פתח את השיחה הראשונה בתכל'ס. The user should start working, not complete a setup interview.",
  'המעטפת ביצעה בדיקה תחומה דרך ה־APIs הרשמיים של Hermes. Use this verified snapshot and do not repeat its checks before asking the first missing question.',
  'Never run hermes doctor, broad scans, connectivity suites, update checks, or CLI --help discovery during onboarding.',
  'שאל שאלה אחת קצרה בכל פעם (לכל היותר שתי שאלות קרובות), ורק אם היא נחוצה כדי לקדם את הבקשה — אין שאלון התקנה.',
  // Role-neutral: the same payload now also opens a community-only first run, so the
  // business-context Skill is named as a conditional, not as an unconditional step.
  'אל תבקש שוב מידע שכבר נמסר. שמור עובדות יציבות דרך Hermes Memory/Profile; אם מדובר בעבודה עסקית — תחזק גם Skill בשם business-context. אל תיצור System Prompt גדול.',
  'הצע אינטגרציה או חיבור רשמי אחד רק כאשר הבקשה הנוכחית זקוקה לו; הסבר את הערך ואשר עם המשתמש לפני פעולה רגישה.',
  'אין לבצע פעולה חיצונית ואין לבקש secret בצ׳אט.',
  'אל תסמן סיום אם אין ספק/מודל זמין או שחיבור שהוצהר לא עבר בדיקת קריאה בטוחה; אפשר להשהות ולחזור להשלים.',
  // provider_state glossary — short sentences on purpose: this is prompt text
  // the model must actually parse, not a machine note.
  'משמעות provider_state בתמונת המצב:',
  'usable — הספק הוכח חי; המשך כרגיל.',
  'configured — נבחר ספק/מודל אך המעטפת לא צפתה בסיבוב חי. התשובה המוצלחת שלך בשיחה הזו היא בעצמה ההוכחה — התייחס למצב הזה כ־usable והמשך.',
  'runtime_only או unavailable — לא נמצא ספק, אחרי שכל המקורות הרשמיים נבדקו.',
  'unknown — מקור רשמי (ראה provider_sources) נכשל או לא נבדק. עצור ואמת מחדש; אל תסמן סיום כוזב ואל תיכשל כוזב.'
];

function buildBootstrapPrompt(input = {}) {
  const { snapshot = {}, data } = input;
  const lines = [...LINES, '', `WRAPPER_VERIFIED_SNAPSHOT=${JSON.stringify(snapshot)}`];
  if (data) lines.push('', JSON.stringify(normalizeOnboarding(data), null, 2));
  return lines.join('\n')
}

// React/Electron snapshot. Honest provider_ready: prefers an already-resolved
// ProviderStatus, else resolves from raw oauth/env; runtime uptime alone is NOT it.
function buildVerifiedSnapshot(input = {}) {
  const { runtime, skills = [], tasks = [], connections = [], providerStatus, oauthProviders, env, error } = input;
  const status = providerStatus || resolveProviderStatus({ runtime, oauthProviders, env, error });
  return {
    provider_ready: status.provider_ready,
    provider_state: status.provider_state,
    provider_label: status.provider_label,
    // Honest configured-vs-usable, so the durable receipt records provider facts from
    // authoritative state (a configured key is NOT proof of usability).
    provider_configured: status.provider_configured === true,
    provider_usable: status.provider_usable === true,
    provider_sources: status.provider_sources,
    runtime_running: Boolean(runtime && runtime.running),
    hermes_version: runtime && runtime.version ? runtime.version : null,
    skills: skills.map(skill => skill && skill.name).filter(Boolean).slice(0, 100),
    scheduled_tasks: tasks.length,
    connections: connections.map(connection => ({
      id: connection.id,
      state: connection.state,
      official: connection.official !== false
    }))
  }
}

// Plugin snapshot: same honest contract, driven by the model id the plugin can see.
function buildModelSnapshot(input = {}) {
  const { model, gateway, profile, skills = [], scheduledTasks = 0 } = input;
  const status = resolveModelReadiness(model);
  return {
    provider_ready: status.provider_ready,
    provider_state: status.provider_state,
    provider_label: status.provider_label,
    model: model || null,
    gateway,
    profile: profile || 'default',
    skills: skills.slice(0, 100),
    scheduled_tasks: scheduledTasks
  }
}

// Resolve the installed Skill through Hermes before submitting the expanded
// model-facing message. A literal slash prompt bypasses this official path.
//
// The Skill name is an explicit argument because the two plugin entry points open
// different conversations: the guided first run does not know yet whether the user
// wants tachles for a business or for a community (tachles-welcome), while the
// fallback questionnaire has already collected business answers (business-bootstrap).
async function submitFirstRunSkill(sessionId, arg, name) {
  const dispatch = await host.request('command.dispatch', {
    session_id: sessionId,
    name,
    arg
  });
  if (dispatch?.type !== 'skill' || dispatch?.name !== name) {
    throw new Error(`Hermes did not resolve /${name} as the requested Skill.`)
  }
  if (typeof dispatch.message !== 'string' || !dispatch.message.trim()) {
    throw new Error(`Hermes resolved /${name}, but returned no Skill message.`)
  }
  await host.request('prompt.submit', { session_id: sessionId, text: dispatch.message });
}

// The guided first-run flow. Instead of a giant static prompt, the trusted wrapper
// performs a bounded inspection through official host APIs, then opens one real
// Hermes session pointed at the tachles-welcome Skill, which senses whether the user
// wants a business or a community assistant and continues into the matching
// bootstrap. The handoff payload comes from the single canonical builder so it can
// never drift from the React wrapper.

const GUIDED_SETUP_VERSION = 2;

function guidedSetupPrompt(snapshot = {}) {
  return buildBootstrapPrompt({ snapshot })
}

async function startGuidedSetup(storage, { force = false } = {}) {
  const previous = storage.get('guidedSetup', {});
  if (
    !force &&
    previous?.version === GUIDED_SETUP_VERSION &&
    ['starting', 'active', 'complete'].includes(previous?.status)
  ) {
    if (previous.storedSessionId) host.navigate(`/${encodeURIComponent(previous.storedSessionId)}`);
    return previous
  }

  const startedAt = new Date().toISOString();
  storage.set('guidedSetup', {
    version: GUIDED_SETUP_VERSION,
    status: 'starting',
    startedAt
  });

  try {
    const [skillsResult, cronResult] = await Promise.all([
      host.request('skills.manage', { action: 'list' }).catch(() => ({})),
      host.request('cron.manage', { action: 'list' }).catch(() => ({}))
    ]);
    const cronJobs = Array.isArray(cronResult?.jobs)
      ? cronResult.jobs
      : Array.isArray(cronResult)
        ? cronResult
        : [];
    const snapshot = buildModelSnapshot({
      gateway: host.state.gateway.get(),
      model: host.state.model.get() || null,
      profile: host.state.profile.get() || 'default',
      skills: [...new Set(flattenSkillNames(skillsResult?.skills || skillsResult))],
      scheduledTasks: cronJobs.length
    });
    const created = await host.request('session.create', {
      title: "הקמת תכל'ס",
      source: 'desktop'
    });
    await submitFirstRunSkill(created.session_id, guidedSetupPrompt(snapshot), WELCOME_COMMAND);
    const next = {
      version: GUIDED_SETUP_VERSION,
      status: 'active',
      startedAt,
      runtimeSessionId: created.session_id,
      storedSessionId: created.stored_session_id || ''
    };
    storage.set('guidedSetup', next);
    storage.set('onboardingComplete', true);
    host.notify({
      kind: 'success',
      title: 'ההיכרות התחילה',
      message: 'העוזר ישאל בכל פעם שאלה קצרה וישמור את ההתקדמות ב־Hermes.'
    });
    if (created.stored_session_id) host.navigate(`/${encodeURIComponent(created.stored_session_id)}`);
    return next
  } catch (error) {
    storage.set('guidedSetup', {
      version: GUIDED_SETUP_VERSION,
      status: 'failed',
      startedAt,
      error: String(error?.message || error)
    });
    throw error
  }
}

// A slim live banner that translates raw Hermes tool events into friendly Hebrew
// activity copy, and surfaces a notification when the agent learns a new Skill.
function ActivityStrip() {
  const [activity, setActivity] = useState('');

  useEffect(() => {
    const stopStart = host.onEvent('tool.start', event => {
      const payload = event?.payload || event || {};
      setActivity(friendlyToolName(payload.name || payload.tool_name || payload.tool));
    });
    const stopDone = host.onEvent('tool.complete', event => {
      const payload = event?.payload || event || {};
      const tool = String(payload.name || payload.tool_name || payload.tool || '').toLowerCase();
      const action = String(payload.arguments?.action || payload.args?.action || '').toLowerCase();
      if (tool === 'skill_manage' && ['create', 'edit', 'patch', 'write_file'].includes(action)) {
        host.notify({
          kind: 'success',
          title: 'Hermes למד תהליך חדש',
          message: 'ה־Skill זמין גם בממשק המלא.'
        });
      }
      setActivity('');
    });
    const stopError = host.onEvent('error', () => setActivity(''));

    return () => {
      stopStart();
      stopDone();
      stopError();
    }
  }, []);

  if (!activity) return null

  return h(
    'div',
    {
      className:
        'mb-4 flex items-center gap-2 rounded-[5px] border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-(--ui-text-secondary)'
    },
    h(Loader, { type: 'lemniscate-bloom', className: 'size-4' }),
    h('span', null, activity)
  )
}

// The business-home shortcut grid. Every tile deep-links into an official Hermes
// screen — no Sessions, Skills or connections are duplicated by the shell.
function HomeQuickActions() {
  return h(
    React.Fragment,
    null,
    h(SectionTitle, {
      eyebrow: 'קיצורי דרך',
      title: 'מה תרצה לעשות?',
      copy: 'הפעולות פותחות את המסכים הרשמיים של Hermes — אין שכפול של Sessions, Skills או חיבורים.'
    }),
    h(
      'div',
      { className: 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' },
      h(QuickAction, {
        icon: '💬',
        title: 'לדבר עם העוזר',
        copy: 'שיחה מלאה עם Streaming, קבצים, פעולות ואישורים.',
        onClick: () => host.navigate('/'),
        badge: 'מומלץ'
      }),
      h(QuickAction, {
        icon: '🗓️',
        title: 'משימות קבועות',
        copy: 'סיכום בוקר, מעקב לידים ותהליכים חוזרים.',
        onClick: () => host.navigate('/cron')
      }),
      h(QuickAction, {
        icon: '✨',
        title: 'מה Hermes למד',
        copy: 'Skills קיימים ותהליכים חדשים שהעוזר למד.',
        onClick: () => host.navigate('/skills')
      }),
      h(QuickAction, {
        icon: '🔌',
        title: 'חיבור שירותים',
        copy: 'Telegram וערוצי הודעות דרך מנגנון Hermes.',
        onClick: () => host.navigate('/messaging')
      }),
      h(QuickAction, {
        icon: '🖼️',
        title: 'תוצרים וקבצים',
        copy: 'Artifacts, תמונות, מסמכים וקישורים מכל השיחות.',
        onClick: () => host.navigate('/artifacts')
      }),
      h(QuickAction, {
        icon: '⚙️',
        title: 'Hermes המלא',
        copy: 'Providers, Logs, עדכונים וכל ההגדרות המתקדמות.',
        onClick: () => host.navigate('/settings')
      })
    )
  )
}

// The business home: live status metrics, recent sessions (searchable) and
// quick-actions that deep-link into the official Hermes screens.
function Overview({ onOnboarding, storage }) {
  const gateway = useValue(host.state.gateway);
  const model = useValue(host.state.model);
  const profile = useValue(host.state.profile);
  const runtime = useAsync(() => evaluateRuntimeReadiness(host.request), [gateway]);
  const [sessionQuery, setSessionQuery] = useState('');
  const sessions = useAsync(() => host.request('session.list', { limit: 50 }), [gateway]);
  const cron = useAsync(() => host.request('cron.manage', { action: 'list' }), [gateway]);
  const providerReady = Boolean(runtime.value?.ready);
  const sessionRows = Array.isArray(sessions.value?.sessions) ? sessions.value.sessions : [];
  const sessionCount = sessionRows.length;
  const visibleSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    const rows = query
      ? sessionRows.filter(row => `${row.title || ''} ${row.preview || ''} ${row.id || ''}`.toLowerCase().includes(query))
      : sessionRows;
    return rows.slice(0, 8)
  }, [sessionQuery, sessions.value]);
  // Active tasks straight from the official cron.manage door — no local cache.
  const { jobs } = summarizeCronJobs(cron.value);
  // A failed sessions/cron read must not render as "0 שיחות · 0 משימות" — that is a
  // confident, proven-empty answer, not the "we couldn't check" truth.
  const activityError = Boolean(sessions.error || cron.error);

  return h(
    React.Fragment,
    null,
    h(ActivityStrip),
    h(
      'div',
      { className: 'mb-6 flex flex-wrap items-start justify-between gap-4' },
      h(
        'div',
        null,
        h('div', { className: 'mb-1 text-[0.6875rem] font-semibold text-primary' }, 'HERMES לעסק'),
        h('h1', { className: 'text-2xl font-semibold tracking-tight text-(--ui-text-primary)' }, 'בוקר טוב 👋'),
        h(
          'p',
          { className: 'mt-1 text-sm text-(--ui-text-tertiary)' },
          'אותו Hermes חזק — עם כניסה פשוטה לעבודה היומיומית.'
        )
      ),
      h(
        'div',
        { className: 'flex gap-2' },
        h(Button, { variant: 'outline', onClick: onOnboarding }, 'היכרות עם העסק'),
        h(Button, { onClick: () => host.navigate('/') }, 'שיחה חדשה')
      )
    ),
    h(
      Card,
      { className: 'mb-5' },
      h(
        'div',
        { className: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4' },
        h(Metric, {
          label: 'Hermes',
          value: gateway === 'open' ? 'פועל ותקין' : 'מתחבר…',
          tone: gateway === 'open' ? 'good' : 'warn'
        }),
        h(Metric, {
          label: 'ספק AI',
          value: runtime.error ? 'לא הצלחנו לבדוק' : providerReady ? model || runtime.value?.model || 'מחובר' : 'נדרשת הגדרה',
          tone: runtime.error ? 'bad' : providerReady ? 'good' : 'warn'
        }),
        h(Metric, { label: 'פרופיל פעיל', value: profile || 'default', tone: 'good' }),
        h(Metric, {
          label: 'פעילות',
          value: activityError ? 'לא הצלחנו לבדוק — נסו לרענן' : `${sessionCount} שיחות אחרונות · ${jobs.length} משימות פעילות`,
          tone: activityError ? 'bad' : 'good'
        })
      )
    ),
    h(
      Card,
      { className: 'mb-5' },
      h(
        'div',
        { className: 'mb-3 flex flex-wrap items-center justify-between gap-3' },
        h(
          'div',
          null,
          h('h2', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, 'שיחות אחרונות'),
          h('p', { className: 'mt-0.5 text-xs text-(--ui-text-tertiary)' }, 'אותן שיחות שמופיעות בממשק המלא, ב־CLI ובערוצי ההודעות.')
        ),
        h(Input, {
          value: sessionQuery,
          onChange: event => setSessionQuery(event.target.value),
          placeholder: 'חיפוש בשיחות',
          'aria-label': 'חיפוש בשיחות',
          className: 'w-full sm:w-64'
        })
      ),
      sessions.loading
        ? h('div', { className: 'py-5 text-center text-xs text-(--ui-text-tertiary)' }, 'טוען שיחות…')
        : sessions.error
          ? h('div', { className: 'py-5 text-center text-xs text-(--ui-text-tertiary)' }, 'לא הצלחנו לבדוק שיחות אחרונות — נסו לרענן.')
          : visibleSessions.length
            ? h(
                'div',
                { className: 'grid gap-2 sm:grid-cols-2' },
                ...visibleSessions.map(session =>
                  h(
                    'button',
                    {
                      key: session.id,
                      type: 'button',
                      onClick: () => host.navigate(`/${encodeURIComponent(session.id)}`),
                      className:
                        'rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 py-2.5 text-right hover:bg-(--ui-bg-tertiary)'
                    },
                    h('div', { className: 'truncate text-xs font-medium text-(--ui-text-primary)' }, session.title || 'שיחה ללא כותרת'),
                    h(
                      'div',
                      { className: 'mt-1 line-clamp-2 text-[0.6875rem] leading-5 text-(--ui-text-tertiary)' },
                      session.preview || 'פתח את השיחה לצפייה'
                    )
                  )
                )
              )
            : h(
                'div',
                { className: 'py-5 text-center text-xs text-(--ui-text-tertiary)' },
                sessionQuery ? 'לא נמצאו שיחות מתאימות.' : 'עדיין אין שיחות. אפשר להתחיל שיחה חדשה.'
              )
    ),
    h(HomeQuickActions)
  )
}

// A quick fallback questionnaire used only when the guided setup session cannot
// start. Field keys and defaults come from the shared canonical contract, so any
// previously persisted (legacy-key) answers are migrated on load, and on save it
// opens one real Hermes session that persists facts through Memory/Profile and a
// business-context Skill — never a giant system prompt.

function Onboarding({ storage, onDone, onCancel }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => normalizeOnboarding(storage.get(STORAGE_KEYS.form, EMPTY_ONBOARDING)));
  const update = (name, value) => setForm(current => ({ ...current, [name]: value }));
  const page = ONBOARDING_STEPS[step];

  async function save() {
    setSaving(true);
    try {
      storage.set(STORAGE_KEYS.form, form);
      const prompt = buildBootstrapPrompt({ data: form });
      const created = await host.request('session.create', {
        title: `היכרות עם ${form.businessName || 'העסק'}`,
        source: 'desktop'
      });
      // The form has already established this is business work, so it goes straight
      // to business-bootstrap rather than through the role-sensing welcome.
      await submitFirstRunSkill(created.session_id, prompt, BOOTSTRAP_COMMAND);
      storage.set(STORAGE_KEYS.pluginComplete, true);
      host.notify({
        kind: 'success',
        title: 'Hermes התחיל ללמוד את העסק',
        message: 'השיחה נשמרת ותופיע גם ברשימת השיחות הרגילה.'
      });
      onDone();
      if (created.stored_session_id) host.navigate(`/${encodeURIComponent(created.stored_session_id)}`);
    } catch (error) {
      host.notifyError(error, 'לא הצלחנו לשמור את ההיכרות');
    } finally {
      setSaving(false);
    }
  }

  return h(
    'div',
    { className: 'mx-auto max-w-2xl' },
    h(
      'div',
      { className: 'mb-6 flex items-center justify-between gap-4' },
      h(
        'div',
        null,
        h(
          'div',
          { className: 'text-[0.6875rem] font-semibold text-primary' },
          `שלב ${step + 1} מתוך ${ONBOARDING_STEPS.length}`
        ),
        h('h1', { className: 'mt-1 text-xl font-semibold text-(--ui-text-primary)' }, page.title),
        h('p', { className: 'mt-1 text-xs text-(--ui-text-tertiary)' }, page.copy)
      ),
      h(Button, { variant: 'text', onClick: onCancel }, 'סגירה')
    ),
    h(
      Card,
      null,
      h(
        'div',
        { className: 'grid gap-4 sm:grid-cols-2' },
        ...page.fields.map(({ key, label, multiline }) =>
          h(Field, {
            key,
            label,
            name: key,
            multiline,
            value: Array.isArray(form[key]) ? form[key].join(', ') : form[key] || '',
            onChange: update
          })
        )
      ),
      h(
        'div',
        { className: 'mt-6 flex items-center justify-between border-t border-(--ui-stroke-secondary) pt-4' },
        h(
          Button,
          { variant: 'outline', disabled: step === 0 || saving, onClick: () => setStep(current => current - 1) },
          'הקודם'
        ),
        step < ONBOARDING_STEPS.length - 1
          ? h(Button, { onClick: () => setStep(current => current + 1) }, 'המשך')
          : h(Button, { disabled: saving, onClick: save }, saving ? 'Hermes לומד…' : 'שמור והמשך לשיחה')
      )
    )
  )
}

// Connection overview. Every card links into an official Hermes screen or opens a
// guided session — the shell never stores credentials or duplicates state itself.
function Connections() {
  const provider = useAsync(() => evaluateRuntimeReadiness(host.request), []);
  const skills = useAsync(() => host.request('skills.manage', { action: 'list' }), []);
  const system = useAsync(() => host.status(), []);
  const skillNames = useMemo(() => {
    return flattenSkillNames(skills.value?.skills).join(' ').toLowerCase()
  }, [skills.value]);
  const hasGoogle = skillNames.includes('google-workspace');
  const platforms = system.value?.gateway_platforms || system.value?.platforms || {};
  const telegramState = String(platforms.telegram?.state || platforms.telegram?.status || '').toLowerCase();
  const telegramConnected = ['connected', 'running', 'ok'].includes(telegramState);

  const cards = [
    {
      title: 'ספק AI',
      copy: 'OpenAI, Anthropic, Gemini, OpenRouter וספקים נוספים.',
      // A failed readiness probe is NOT proof the provider isn't configured —
      // show it as an explicit unknown, never as the same "נדרשת הגדרה" a
      // genuinely-unconfigured provider would render.
      status: provider.loading ? 'בודק…' : provider.error ? 'לא הצלחנו לבדוק — נסו לרענן' : provider.value?.ready ? 'מוגדר' : 'נדרשת הגדרה',
      connected: Boolean(provider.value?.ready),
      error: Boolean(provider.error),
      action: () => host.navigate('/settings?tab=providers&pview=keys')
    },
    {
      title: 'Google Workspace',
      copy: 'Gmail, יומן, Drive, Docs ו־Sheets דרך ה־Skill הרשמי.',
      // Same rule for the skills-list read: a failed probe must not read as the
      // confident "התקנת Skill נדרשת" a real not-installed Skill would show.
      status: skills.loading ? 'בודק…' : skills.error ? 'לא הצלחנו לבדוק — נסו לרענן' : hasGoogle ? 'יכולת החיבור זמינה' : 'התקנת Skill נדרשת',
      connected: false,
      error: Boolean(skills.error),
      action: async () => {
        try {
          const created = await host.request('session.create', { title: 'חיבור Google Workspace', source: 'desktop' });
          await host.request('prompt.submit', {
            session_id: created.session_id,
            text:
              'עזור לי לחבר Google Workspace באמצעות ה-Skill הרשמי google-workspace של Hermes. הצג כל שלב בפשטות, פתח את כתובת האישור בדפדפן, ואל תבצע פעולת כתיבה בשירות ללא אישור.'
          });
          if (created.stored_session_id) host.navigate(`/${encodeURIComponent(created.stored_session_id)}`);
        } catch (error) {
          host.notifyError(error, 'לא הצלחנו לפתוח את תהליך החיבור');
        }
      }
    },
    {
      title: 'Telegram',
      copy: 'דבר עם אותו Hermes גם מהטלפון באמצעות ה־gateway המובנה.',
      // A failed status probe must not read as the confident "לא מחובר" a real
      // disconnected channel would show.
      status: telegramConnected ? 'מחובר' : system.loading ? 'בודק…' : system.error ? 'לא הצלחנו לבדוק — נסו לרענן' : 'לא מחובר',
      connected: telegramConnected,
      error: Boolean(system.error),
      action: () => host.navigate('/messaging')
    }
  ];

  return h(
    React.Fragment,
    null,
    h(SectionTitle, {
      eyebrow: 'חיבורים',
      title: 'השירותים של העסק',
      copy: 'כל חיבור נשמר ומנוהל על ידי Hermes. המעטפת רק מקצרת את הדרך למסך או ל־Skill הרשמי.'
    }),
    h(
      'div',
      { className: 'grid gap-3 lg:grid-cols-3' },
      ...cards.map(card =>
        h(
          Card,
          { key: card.title },
          h('h3', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, card.title),
          h('p', { className: 'mt-1 min-h-10 text-xs leading-5 text-(--ui-text-tertiary)' }, card.copy),
          h(
            'div',
            { className: 'mt-4 flex items-center justify-between gap-2' },
            h(
              'span',
              { className: 'flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-tertiary)' },
              h(StatusDot, { tone: card.error ? 'bad' : card.connected ? 'good' : 'muted' }),
              card.status
            ),
            h(Button, { variant: card.connected ? 'outline' : 'default', onClick: card.action }, card.connected ? 'ניהול' : 'חבר')
          )
        )
      )
    ),
    h(
      Card,
      { className: 'mt-3' },
      h(
        'div',
        { className: 'flex flex-wrap items-center justify-between gap-3' },
        h(
          'div',
          null,
          h('h3', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, 'WhatsApp'),
          h(
            'p',
            { className: 'mt-1 max-w-2xl text-xs leading-5 text-(--ui-text-tertiary)' },
            'Hermes תומך גם ב־WhatsApp Business Cloud API וגם בחיבור אישי דרך API צד שלישי. הרישום דרך צד שלישי עלול להשתנות, להיחסם או להביא להגבלת החשבון; מומלץ מספר ייעודי.'
          )
        ),
        h(Button, { variant: 'outline', onClick: () => host.navigate('/messaging') }, 'הצג אפשרויות')
      )
    )
  )
}

// Presets shown in the "when" <select> below, one single source
// (../../../../shared/schedule-display.js) shared with the React app's schedule
// picker. Labels are DERIVED via humanizeSchedule(), never hand-duplicated, so
// adding a fourth preset there is the only change needed — it can no longer
// silently fall back to raw cron on one side while the other renders it fine.
const SCHEDULE_PRESETS = SCHEDULE_PRESET_VALUES.map(value => ({ value, label: humanizeSchedule(value) }));

// The "new scheduled task" composer. It offers human-friendly presets but persists
// everything through the official Hermes cron.manage door, then asks the parent to
// refresh its list via onCreated.
function NewTaskForm({ onCreated }) {
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState(SCHEDULE_PRESET_VALUES[0]);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim() || !prompt.trim()) return
    setSaving(true);
    try {
      await host.request('cron.manage', { action: 'add', name: name.trim(), schedule, prompt: prompt.trim() });
      host.notify({ kind: 'success', title: 'המשימה נוצרה', message: 'היא מופיעה גם במסך Cron המלא.' });
      setName('');
      setPrompt('');
      onCreated();
    } catch (error) {
      host.notifyError(error, 'לא הצלחנו ליצור משימה');
    } finally {
      setSaving(false);
    }
  }

  return h(
    Card,
    null,
    h('h3', { className: 'mb-3 text-sm font-semibold text-(--ui-text-primary)' }, 'משימה חדשה'),
    h(
      'div',
      { className: 'grid gap-3' },
      h(Field, { label: 'שם', name: 'name', value: name, onChange: (_, value) => setName(value), placeholder: 'סיכום בוקר' }),
      h(
        'label',
        { className: 'grid gap-1.5' },
        h('span', { className: 'text-xs font-medium text-(--ui-text-secondary)' }, 'מתי'),
        h(
          'select',
          {
            value: schedule,
            onChange: event => setSchedule(event.target.value),
            className:
              'h-8 rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-2 text-xs text-(--ui-text-primary)'
          },
          ...SCHEDULE_PRESETS.map(preset => h('option', { key: preset.value, value: preset.value }, preset.label))
        )
      ),
      h(Field, {
        label: 'מה Hermes יעשה?',
        name: 'prompt',
        value: prompt,
        multiline: true,
        onChange: (_, value) => setPrompt(value),
        placeholder: 'סכם את הפגישות והמשימות החשובות להיום'
      }),
      h(Button, { disabled: saving || !name.trim() || !prompt.trim(), onClick: create }, saving ? 'יוצר…' : 'צור משימה')
    )
  )
}

// Scheduled-task management. Hermes is the ONLY source of truth: the list comes
// from this plugin's own namespace-locked backend door, which reads the
// authoritative scheduler list_jobs(include_disabled=True) — active AND paused,
// one store, no local cache. If that companion backend isn't available the
// loader falls back to the active-only cron.manage RPC and we say so honestly
// instead of shadowing ghost rows. Mutations stay official cron.manage ops.
function Automations({ storage }) {
  const [refresh, setRefresh] = useState(0);
  const result = useAsync(() => loadScheduledTasks(), [refresh]);
  const jobs = result.value?.jobs || [];
  const pausedListingSupported = Boolean(result.value?.pausedListingSupported);

  // Non-authoritative, one-time cleanup of any legacy paused-task cache.
  useEffect(() => {
    purgeLegacyPausedCache(storage);
  }, []);

  async function toggle(job) {
    const id = cronJobId(job);
    if (!id) return
    const paused = isJobPaused(job);
    try {
      await host.request('cron.manage', { action: paused ? 'resume' : 'pause', name: id });
      host.notify({
        kind: 'success',
        title: paused ? 'המשימה הופעלה' : 'המשימה הושהתה',
        message: paused ? 'השינוי נשמר ב־Hermes המלא.' : 'היא מנוהלת כעת במסך Cron המלא של Hermes.'
      });
      setRefresh(value => value + 1);
    } catch (error) {
      host.notifyError(error, 'לא הצלחנו לעדכן את המשימה');
    }
  }

  return h(
    React.Fragment,
    null,
    h(SectionTitle, {
      eyebrow: 'אוטומציות',
      title: 'משימות קבועות',
      copy: 'המעטפת מציעה תבנית אנושית, אבל שומרת אותה במנגנון ה־Cron הרשמי של Hermes.'
    }),
    h(
      'div',
      { className: 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]' },
      h(
        Card,
        null,
        result.loading
          ? h('div', { className: 'py-8 text-center text-xs text-(--ui-text-tertiary)' }, 'טוען משימות…')
          : // A failed read is NOT proof of "no scheduled tasks" — show it as an
            // explicit problem, never as the same empty state a genuinely-empty
            // list would render.
            result.error
            ? h(
                'div',
                { className: 'flex flex-col items-center gap-2 py-8 text-center text-xs text-(--ui-text-tertiary)' },
                h(StatusDot, { tone: 'bad' }),
                'לא הצלחנו לבדוק משימות מתוזמנות — נסו לרענן.'
              )
            : jobs.length
              ? h(
                  'div',
                  { className: 'grid gap-2' },
                  ...jobs.map((job, index) =>
                    h(
                      'div',
                      {
                        key: cronJobId(job) || index,
                        className:
                          'flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-(--ui-stroke-secondary) px-3 py-2.5'
                      },
                      h(
                        'div',
                        null,
                        h('div', { className: 'text-xs font-medium text-(--ui-text-primary)' }, job.name || 'משימה'),
                        h(
                          'div',
                          { className: 'mt-0.5 text-[0.6875rem] text-(--ui-text-tertiary)' },
                          humanSchedule(job.schedule_display || job.schedule || job.cron)
                        )
                      ),
                      h(
                        'div',
                        { className: 'flex items-center gap-2' },
                        h(Badge, { variant: isJobPaused(job) ? 'muted' : 'default' }, isJobPaused(job) ? 'מושהית' : 'פעילה'),
                        h(Button, { variant: 'outline', size: 'sm', onClick: () => toggle(job) }, isJobPaused(job) ? 'הפעל' : 'השהה')
                      )
                    )
                  )
                )
              : h('div', { className: 'py-8 text-center text-xs text-(--ui-text-tertiary)' }, 'עדיין אין משימות מתוזמנות.'),
        // Honest degrade: shown only when the read succeeded but the paused-inclusive
        // backend door is unavailable and we fell back to the active-only cron.manage
        // RPC. A failed read already has its own message above — don't stack a second,
        // unrelated notice on top of it.
        pausedListingSupported || result.error
          ? null
          : h(
              'p',
              { className: 'mt-4 text-[0.6875rem] leading-5 text-(--ui-text-tertiary)' },
              'התצוגה הפשוטה מציגה משימות פעילות מתוך Hermes. משימות מושהות נשמרות ב־Hermes ומנוהלות במסך ה־Cron המלא.'
            ),
        h(
          'div',
          { className: 'mt-4 flex flex-wrap justify-end gap-2' },
          h(Button, { variant: 'text', onClick: () => setRefresh(value => value + 1) }, 'רענן'),
          h(Button, { variant: 'textStrong', onClick: () => host.navigate('/cron') }, 'פתח ניהול מלא')
        )
      ),
      h(NewTaskForm, { onCreated: () => setRefresh(value => value + 1) })
    )
  )
}

// System health for a non-technical owner. Every button drives an official Hermes
// door (status, gateway, logs); nothing is uploaded and there is no remote access.
function Support({ storage }) {
  const gateway = useValue(host.state.gateway);
  const model = useValue(host.state.model);
  const profile = useValue(host.state.profile);
  const [refresh, setRefresh] = useState(0);
  const status = useAsync(() => host.status(), [refresh]);
  const runtime = useAsync(() => evaluateRuntimeReadiness(host.request), [refresh]);
  const cron = useAsync(() => host.request('cron.manage', { action: 'list' }), [refresh]);
  const [logs, setLogs] = useState('');
  const [checking, setChecking] = useState(false);
  // Active tasks from the official cron.manage door — no local paused cache.
  const { jobs: activeJobs } = summarizeCronJobs(cron.value);
  const platformEntries = Object.values(status.value?.gateway_platforms || status.value?.platforms || {});
  const connectedPlatforms = platformEntries.filter(platform => {
    const state = String(platform?.state || platform?.status || '').toLowerCase();
    return ['connected', 'running', 'ok'].includes(state)
  }).length;

  async function check() {
    setChecking(true);
    try {
      const [snapshot, readiness] = await Promise.all([host.status(), evaluateRuntimeReadiness(host.request)]);
      const gatewayReady = host.state.gateway.get() === 'open';
      if (!gatewayReady || !readiness?.ready) {
        throw new Error(snapshot?.error || 'Hermes או ספק ה־AI אינם מוכנים')
      }
      host.notify({
        kind: 'success',
        title: 'בדיקת התקינות עברה',
        message: `Hermes פועל עם ${host.state.model.get() || readiness.model || 'המודל המוגדר'}.`
      });
    } catch (error) {
      host.notifyError(error, 'בדיקת התקינות מצאה בעיה');
    } finally {
      setRefresh(value => value + 1);
      setChecking(false);
    }
  }

  async function showLogs() {
    try {
      const value = await host.logs({ file: 'errors', lines: 120 });
      setLogs(Array.isArray(value?.lines) ? value.lines.join('\n') : JSON.stringify(value, null, 2));
    } catch (error) {
      host.notifyError(error, 'לא הצלחנו לפתוח את ה־Logs');
    }
  }

  return h(
    React.Fragment,
    null,
    h(SectionTitle, {
      eyebrow: 'תמיכה',
      title: 'מצב המערכת',
      copy: 'הבדיקות מפעילות את דלתות ה־status וה־gateway הרשמיות של Hermes.'
    }),
    h(
      Card,
      null,
      h(
        'div',
        { className: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4' },
        h(Metric, { label: 'Hermes', value: gateway === 'open' ? 'פועל' : gateway, tone: gateway === 'open' ? 'good' : 'warn' }),
        h(Metric, {
          label: 'Provider',
          // A failed readiness probe is not proof the provider is unready — say so
          // explicitly instead of reusing the same "לא מוכן" a real failure shows.
          value: runtime.loading ? 'בודק…' : runtime.error ? 'לא הצלחנו לבדוק' : runtime.value?.ready ? model || 'מוגדר' : 'לא מוכן',
          tone: runtime.loading ? 'warn' : runtime.error ? 'bad' : runtime.value?.ready ? 'good' : 'bad'
        }),
        h(Metric, {
          label: 'גרסת Hermes',
          // status.error must not collapse into the same "נבדקת…" a still-loading
          // read shows — the read already finished, and it failed.
          value: status.error ? 'לא הצלחנו לבדוק' : status.value?.version || status.value?.hermes_version || 'נבדקת…',
          tone: status.error ? 'bad' : 'good'
        }),
        h(Metric, { label: 'פרופיל', value: profile || 'default', tone: 'good' }),
        h(Metric, {
          label: 'חיבורים',
          // A failed status read must not render as the confident "אין חיבורים
          // מוגדרים" a genuinely-empty platform list would show.
          value: status.error
            ? 'לא הצלחנו לבדוק'
            : platformEntries.length
              ? `${connectedPlatforms} מתוך ${platformEntries.length} מחוברים`
              : 'אין חיבורים מוגדרים',
          tone: status.error ? 'bad' : connectedPlatforms ? 'good' : 'warn'
        }),
        h(Metric, {
          label: 'משימות פעילות',
          // Same rule for a failed cron read: never render "0 פעילות" as if the
          // list were proven empty.
          value: cron.error ? 'לא הצלחנו לבדוק' : `${activeJobs.length} פעילות`,
          tone: cron.error ? 'bad' : activeJobs.length ? 'good' : 'warn'
        })
      ),
      h(
        'div',
        { className: 'mt-5 flex flex-wrap gap-2 border-t border-(--ui-stroke-secondary) pt-4' },
        h(Button, { disabled: checking, onClick: check }, checking ? 'בודק…' : 'בדיקת תקינות'),
        h(Button, { variant: 'outline', onClick: () => host.restartGateway() }, 'הפעל מחדש את Hermes'),
        h(Button, { variant: 'outline', onClick: showLogs }, 'פתח Logs'),
        h(Button, { variant: 'outline', onClick: () => host.navigate('/settings?tab=about') }, 'עדכונים וגרסאות'),
        h(Button, { variant: 'textStrong', onClick: () => host.navigate('/settings?tab=gateway') }, 'אבחון מתקדם')
      )
    ),
    logs
      ? h(
          Card,
          { className: 'mt-4' },
          h(
            'div',
            { className: 'mb-2 flex items-center justify-between' },
            h('h3', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, 'שגיאות אחרונות'),
            h(Button, { variant: 'text', onClick: () => setLogs('') }, 'סגור')
          ),
          h(
            'pre',
            {
              className:
                'max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-[4px] bg-(--ui-bg-primary) p-3 text-[0.6875rem] leading-5 text-(--ui-text-secondary)'
            },
            logs
          )
        )
      : null,
    h(
      'p',
      { className: 'mt-4 text-[0.6875rem] leading-5 text-(--ui-text-quaternary)' },
      'האבחון המתקדם הוא המסך הרשמי של Hermes ואינו מעלה דבר אוטומטית. ZIP מצומצם ללא שיחות, מיילים או קבצי עסק זמין ב־launcher של המעטפת. אין במעטפת גישה מרחוק או backdoor.'
    )
  )
}

// The top-level shell: RTL layout, tab navigation, guided-setup orchestration and
// the fallback quick onboarding. Screens themselves live in ./screens.
function BusinessShell({ storage }) {
  const [view, setView] = useState('home');
  const [onboarding, setOnboarding] = useState(false);
  const [guidedSetupBusy, setGuidedSetupBusy] = useState(false);
  const [guidedSetupError, setGuidedSetupError] = useState('');
  const nav = [
    ['home', 'בית'],
    ['automations', 'משימות'],
    ['connections', 'חיבורים'],
    ['support', 'תמיכה']
  ];

  async function openGuidedSetup(force = false) {
    setGuidedSetupBusy(true);
    setGuidedSetupError('');
    try {
      await startGuidedSetup(storage, { force });
    } catch (error) {
      setGuidedSetupError(String(error?.message || error));
    } finally {
      setGuidedSetupBusy(false);
    }
  }

  useEffect(() => {
    const setup = storage.get('guidedSetup', {});
    if (setup?.version === GUIDED_SETUP_VERSION && ['starting', 'active', 'complete'].includes(setup?.status)) {
      return
    }
    void openGuidedSetup(false);
  }, [storage]);

  return h(
    'main',
    {
      dir: 'rtl',
      lang: 'he',
      className: 'h-full min-h-0 overflow-auto bg-(--ui-bg-primary) text-(--ui-text-primary)'
    },
    h(
      'div',
      { className: 'mx-auto min-h-full w-full max-w-6xl px-5 py-5 sm:px-7' },
      h(
        'nav',
        {
          'aria-label': 'ניווט עסקי',
          className: 'mb-6 flex flex-wrap items-center gap-1 border-b border-(--ui-stroke-secondary) pb-2'
        },
        ...nav.map(([id, label]) =>
          h(
            Button,
            {
              key: id,
              variant: view === id ? 'secondary' : 'ghost',
              size: 'sm',
              onClick: () => {
                setOnboarding(false);
                setView(id);
              }
            },
            label
          )
        ),
        h('span', { className: 'flex-1' }),
        h(Button, { variant: 'textStrong', size: 'inline', onClick: () => host.navigate('/') }, 'פתח את Hermes המלא')
      ),
      guidedSetupBusy
        ? h(
            Card,
            { className: 'mb-4' },
            h(
              'div',
              { className: 'flex items-center gap-3 text-sm text-(--ui-text-secondary)' },
              h(Loader, { type: 'lemniscate-bloom', className: 'size-4' }),
              h('span', null, 'מכין שיחת היכרות אישית עם העוזר…')
            )
          )
        : guidedSetupError
          ? h(
              Card,
              { className: 'mb-4' },
              h('h2', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, 'לא הצלחנו להתחיל את ההיכרות'),
              h(
                'p',
                { className: 'mt-1 text-xs leading-5 text-(--ui-text-tertiary)' },
                'אפשר לנסות שוב, או להשתמש זמנית בטופס המהיר.'
              ),
              h(
                'div',
                { className: 'mt-3 flex gap-2' },
                h(Button, { onClick: () => openGuidedSetup(true) }, 'נסה שוב'),
                h(Button, { variant: 'outline', onClick: () => setOnboarding(true) }, 'טופס מהיר')
              )
            )
          : null,
      onboarding
        ? h(Onboarding, { storage, onDone: () => setOnboarding(false), onCancel: () => setOnboarding(false) })
        : view === 'automations'
          ? h(Automations, { storage })
          : view === 'connections'
            ? h(Connections)
            : view === 'support'
              ? h(Support, { storage })
          : h(Overview, { storage, onOnboarding: () => openGuidedSetup(false) })
    )
  )
}

// Entry module: the official Hermes Desktop plugin contract. It contributes a
// route, a sidebar entry and a command-palette action, all pointing at the
// business shell. This is the object bundled to plugin.js as the default export.
const ROUTE = '/business';

export default {
  id: 'business-shell',
  name: 'Hermes לעסק',
  defaultEnabled: true,
  register(ctx) {
    // Install this plugin's own namespace-locked backend door (/api/plugins/
    // business-shell). It powers the paused-inclusive scheduled-task list and
    // degrades to the active-only cron.manage RPC when the companion backend
    // isn't present. Safe no-op when the runtime SDK doesn't expose ctx.rest.
    setPluginRest(ctx.rest);
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        title: 'Hermes לעסק',
        data: { path: ROUTE },
        render: () => h(BusinessShell, { storage: ctx.storage })
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 10,
        data: { path: ROUTE, label: 'לעסק', codicon: 'briefcase' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'business.open',
          label: 'פתח את Hermes לעסק',
          keywords: ['business', 'עסק', 'פשוט'],
          run: () => host.navigate(ROUTE)
        }
      }
    ]);
  }
};

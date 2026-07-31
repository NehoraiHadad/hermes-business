// GENERATED FILE — do not edit by hand.
// Source: hermes-plugin/business-shell/src/*  ·  Builder: scripts/build-plugin.mjs
// Run `npm run build:plugin` after changing the src modules. Verified by
// `npm run verify:plugin` (stale-artifact check) and src/lib/plugin-source.test.ts.
// Hermes Desktop loads this single file and compiles it without JSX, so every
// element is built with React.createElement and only 'react' and
// '@hermes/plugin-sdk' may be imported.
import { StatusDot, Badge, Textarea, Input, host, Loader, useValue, evaluateRuntimeReadiness, Button, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA } from '@hermes/plugin-sdk'
import React, { useState, useEffect, useMemo } from 'react'

// Hermes compiles the shipped plugin without JSX, so every element is built with
// React.createElement. `h` is the shared shorthand used across the shell modules.
const h = React.createElement;

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

// Pure helpers and small hooks shared by the business shell screens. No JSX and
// no side effects at module load — safe for the contract test that evaluates the
// bundled plugin in a bare VM.

const PAUSED_CRON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  return key ? TOOL_COPY[key] : 'מבצע פעולה…'
}

function humanSchedule(raw) {
  const schedule =
    raw && typeof raw === 'object'
      ? String(raw.display || raw.expr || raw.cron || raw.value || '')
      : String(raw || '');
  const known = {
    '0 8 * * 0-4': 'ימים א׳–ה׳ בשעה 08:00',
    '0 9 * * *': 'כל יום בשעה 09:00',
    '0 9 * * 0': 'כל יום ראשון בשעה 09:00'
  };
  return known[schedule] || schedule || 'לפי לוח הזמנים של Hermes'
}

function readPausedCronCache(storage) {
  const now = Date.now();
  const cached = storage.get('pausedCronJobs', []);
  const fresh = Array.isArray(cached)
    ? cached.filter(job => {
        const cachedAt = Date.parse(String(job?.cachedAt || ''));
        return Number.isFinite(cachedAt) && now - cachedAt < PAUSED_CRON_CACHE_TTL_MS
      })
    : [];
  if (fresh.length !== (Array.isArray(cached) ? cached.length : 0)) {
    storage.set('pausedCronJobs', fresh);
  }
  return fresh
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

// The guided first-run flow. Instead of a giant static prompt, the trusted
// wrapper performs a bounded inspection through official host APIs, then opens
// one real Hermes session pointed at the /business-bootstrap Skill.

const GUIDED_SETUP_VERSION = 2;

function guidedSetupPrompt(snapshot = {}) {
  return [
    '/business-bootstrap',
    'הקמת העוזר לעסק.',
    'This is the first-run setup for a non-technical business owner.',
    'The trusted Hermes Desktop wrapper already performed the bounded inspection below through official APIs.',
    'Use this verified snapshot and do not repeat its checks before asking the first missing question.',
    'Never run hermes doctor, broad scans, connectivity suites, update checks, or CLI --help discovery during onboarding.',
    'Resume existing durable business context instead of asking for facts Hermes already knows.',
    'Ask only the next one or two closely related questions. Prefer Hermes native structured question UI when it is available.',
    'Do not dump the full questionnaire, do not request secrets in chat, and do not perform external actions without explicit approval.',
    'Persist stable facts through Hermes Memory/Profile and maintain a business-context Skill.',
    'After understanding the business, recommend exactly one existing Hermes Skill or messaging connection with the clearest immediate value, explain why, and wait for approval before setup.',
    'Verify every completed connection with a safe read-only check.',
    `WRAPPER_VERIFIED_SNAPSHOT=${JSON.stringify(snapshot)}`,
    'Begin now with a short explanation and the first missing question.'
  ].join('\n')
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
    const snapshot = {
      gateway: host.state.gateway.get(),
      model: host.state.model.get() || null,
      profile: host.state.profile.get() || 'default',
      skills: [...new Set(flattenSkillNames(skillsResult?.skills || skillsResult))].slice(0, 100),
      scheduled_tasks: cronJobs.length
    };
    const created = await host.request('session.create', {
      title: 'הקמת העוזר לעסק',
      source: 'desktop'
    });
    await host.request('prompt.submit', {
      session_id: created.session_id,
      text: guidedSetupPrompt(snapshot)
    });
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
  const activeJobs = Array.isArray(cron.value?.jobs) ? cron.value.jobs : Array.isArray(cron.value) ? cron.value : [];
  const pausedJobs = readPausedCronCache(storage);
  const activeJobIds = new Set(activeJobs.map(job => job.id || job.name).filter(Boolean));
  const jobs = [...activeJobs, ...pausedJobs.filter(job => !activeJobIds.has(job.id || job.name))];

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
          value: providerReady ? model || runtime.value?.model || 'מחובר' : 'נדרשת הגדרה',
          tone: providerReady ? 'good' : 'warn'
        }),
        h(Metric, { label: 'פרופיל פעיל', value: profile || 'default', tone: 'good' }),
        h(Metric, {
          label: 'פעילות',
          value: `${sessionCount} שיחות אחרונות · ${jobs.length} משימות`,
          tone: 'good'
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
// start. On save it opens one real Hermes session that persists the facts through
// Memory/Profile and a business-context Skill — never a giant system prompt.

const EMPTY_ONBOARDING = {
  name: '',
  role: '',
  language: 'עברית',
  answerStyle: 'קצר ומעשי',
  workHours: '',
  approvals: 'שליחת הודעות, התחייבויות כספיות ומחיקת מידע',
  repetitiveTasks: '',
  businessName: '',
  industry: '',
  offerings: '',
  customers: '',
  openingHours: '',
  voice: '',
  forbiddenPromises: '',
  processes: '',
  systems: ''
};

const PAGES = [
  {
    title: 'נעים להכיר',
    copy: 'כמה פרטים שיעזרו ל־Hermes לעבוד כמו שמתאים לך.',
    fields: [
      ['שם', 'name'],
      ['תפקיד', 'role'],
      ['שפה מועדפת', 'language'],
      ['סגנון תשובות', 'answerStyle'],
      ['שעות עבודה', 'workHours']
    ]
  },
  {
    title: 'העסק',
    copy: 'המידע יישמר ב־Memory וב־Skill של Hermes, לא ב־prompt ענקי.',
    fields: [
      ['שם העסק', 'businessName'],
      ['תחום פעילות', 'industry'],
      ['שירותים ומוצרים', 'offerings', true],
      ['סוגי לקוחות', 'customers'],
      ['שעות פעילות', 'openingHours']
    ]
  },
  {
    title: 'איך נכון לעבוד',
    copy: 'גבולות ברורים ותהליכים שהעוזר יכול לחסוך.',
    fields: [
      ['פעולות שדורשות אישור', 'approvals', true],
      ['סגנון התקשורת של העסק', 'voice', true],
      ['מגבלות והתחייבויות שאסור לתת', 'forbiddenPromises', true],
      ['תהליכים חוזרים', 'processes', true],
      ['מערכות וקבצים בשימוש', 'systems', true],
      ['משימות שתרצה לחסוך', 'repetitiveTasks', true]
    ]
  }
];

function Onboarding({ storage, onDone, onCancel }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => storage.get('onboarding', EMPTY_ONBOARDING));
  const update = (name, value) => setForm(current => ({ ...current, [name]: value }));
  const page = PAGES[step];

  async function save() {
    setSaving(true);
    try {
      storage.set('onboarding', form);
      const prompt = [
        'זו משימת onboarding מפורשת שאושרה על ידי המשתמש.',
        'שמור את עובדות המשתמש הקצרות והיציבות באמצעות מנגנון ה-memory/profile הרשמי של Hermes.',
        'צור או עדכן Skill בשם business-context עבור ההקשר העסקי המפורט והתהליכים החוזרים.',
        'אל תשמור secrets. אל תיצור system prompt. אל תבצע פעולות חיצוניות.',
        '',
        JSON.stringify(form, null, 2),
        '',
        'בסיום, סכם בקצרה מה נשמר ואיפה.'
      ].join('\n');
      const created = await host.request('session.create', {
        title: `היכרות עם ${form.businessName || 'העסק'}`,
        source: 'desktop'
      });
      await host.request('prompt.submit', { session_id: created.session_id, text: prompt });
      storage.set('onboardingComplete', true);
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
        h('div', { className: 'text-[0.6875rem] font-semibold text-primary' }, `שלב ${step + 1} מתוך ${PAGES.length}`),
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
        ...page.fields.map(([label, name, multiline]) =>
          h(Field, {
            key: name,
            label,
            name,
            multiline,
            value: form[name] || '',
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
        step < PAGES.length - 1
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
      status: provider.loading ? 'בודק…' : provider.value?.ready ? 'מוגדר' : 'נדרשת הגדרה',
      connected: Boolean(provider.value?.ready),
      action: () => host.navigate('/settings?tab=providers&pview=keys')
    },
    {
      title: 'Google Workspace',
      copy: 'Gmail, יומן, Drive, Docs ו־Sheets דרך ה־Skill הרשמי.',
      status: hasGoogle ? 'יכולת החיבור זמינה' : 'התקנת Skill נדרשת',
      connected: false,
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
      status: telegramConnected ? 'מחובר' : system.loading ? 'בודק…' : 'לא מחובר',
      connected: telegramConnected,
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
              h(StatusDot, { tone: card.connected ? 'good' : 'muted' }),
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
            'Hermes תומך גם ב־WhatsApp Business Cloud API הרשמי וגם ב־Baileys (WhatsApp Web לא רשמי). החיבור הלא רשמי עלול להיחסם; מומלץ מספר ייעודי.'
          )
        ),
        h(Button, { variant: 'outline', onClick: () => host.navigate('/messaging') }, 'הצג אפשרויות')
      )
    )
  )
}

// The "new scheduled task" composer. It offers human-friendly presets but persists
// everything through the official Hermes cron.manage door, then asks the parent to
// refresh its list via onCreated.
function NewTaskForm({ onCreated }) {
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 8 * * 0-4');
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
          h('option', { value: '0 8 * * 0-4' }, 'ימים א׳–ה׳ בשעה 08:00'),
          h('option', { value: '0 9 * * *' }, 'כל יום בשעה 09:00'),
          h('option', { value: '0 9 * * 0' }, 'כל יום ראשון בשעה 09:00')
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

// Scheduled-task management. Hermes remains the source of truth; a short-lived
// local cache only bridges paused jobs that the gateway omits from its list.
function Automations({ storage }) {
  const [refresh, setRefresh] = useState(0);
  const [pausedJobs, setPausedJobs] = useState(() => readPausedCronCache(storage));
  const result = useAsync(() => host.request('cron.manage', { action: 'list' }), [refresh]);
  const activeJobs = Array.isArray(result.value?.jobs)
    ? result.value.jobs
    : Array.isArray(result.value)
      ? result.value
      : [];
  const activeIds = new Set(activeJobs.map(job => job.id || job.name).filter(Boolean));
  const jobs = [
    ...activeJobs,
    ...pausedJobs.filter(job => !activeIds.has(job.id || job.name))
  ];

  function savePausedJobs(next) {
    setPausedJobs(next);
    storage.set('pausedCronJobs', next);
  }

  async function toggle(job) {
    const id = job.id || job.name;
    if (!id) return
    const paused = job.paused || job.enabled === false;
    try {
      await host.request('cron.manage', { action: paused ? 'resume' : 'pause', name: id });
      if (paused) {
        savePausedJobs(pausedJobs.filter(item => (item.id || item.name) !== id));
      } else {
        savePausedJobs([
          ...pausedJobs.filter(item => (item.id || item.name) !== id),
          { ...job, enabled: false, paused: true, cachedAt: new Date().toISOString() }
        ]);
      }
      host.notify({
        kind: 'success',
        title: paused ? 'המשימה הופעלה' : 'המשימה הושהתה',
        message: 'השינוי נשמר גם במסך Cron המלא.'
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
      copy: 'ה־POC מציע תבנית אנושית, אבל שומר אותה במנגנון ה־Cron הרשמי של Hermes.'
    }),
    h(
      'div',
      { className: 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]' },
      h(
        Card,
        null,
        result.loading
          ? h('div', { className: 'py-8 text-center text-xs text-(--ui-text-tertiary)' }, 'טוען משימות…')
          : jobs.length
            ? h(
                'div',
                { className: 'grid gap-2' },
                ...jobs.map((job, index) =>
                  h(
                    'div',
                    {
                      key: job.id || job.name || index,
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
                        humanSchedule(job.schedule || job.cron)
                      )
                    ),
                    h(
                      'div',
                      { className: 'flex items-center gap-2' },
                      h(
                        Badge,
                        { variant: job.enabled === false || job.paused ? 'muted' : 'default' },
                        job.enabled === false || job.paused ? 'מושהית' : 'פעילה'
                      ),
                      h(
                        Button,
                        { variant: 'outline', size: 'sm', onClick: () => toggle(job) },
                        job.enabled === false || job.paused ? 'הפעל' : 'השהה'
                      )
                    )
                  )
                )
              )
            : h('div', { className: 'py-8 text-center text-xs text-(--ui-text-tertiary)' }, 'עדיין אין משימות קבועות.'),
        h(
          'div',
          { className: 'mt-4 flex flex-wrap justify-end gap-2' },
          h(
            Button,
            {
              variant: 'text',
              onClick: () => {
                savePausedJobs([]);
                setRefresh(value => value + 1);
                host.notify({
                  kind: 'success',
                  title: 'התצוגה סונכרנה',
                  message: 'מטמון המשימות המושהות נוקה; Hermes המלא נשאר מקור האמת.'
                });
              }
            },
            'סנכרן'
          ),
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
  const activeJobs = Array.isArray(cron.value?.jobs) ? cron.value.jobs : Array.isArray(cron.value) ? cron.value : [];
  const pausedJobs = readPausedCronCache(storage);
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
          value: runtime.loading ? 'בודק…' : runtime.value?.ready ? model || 'מוגדר' : 'לא מוכן',
          tone: runtime.loading ? 'warn' : runtime.value?.ready ? 'good' : 'bad'
        }),
        h(Metric, {
          label: 'גרסת Hermes',
          value: status.value?.version || status.value?.hermes_version || 'נבדקת…',
          tone: 'good'
        }),
        h(Metric, { label: 'פרופיל', value: profile || 'default', tone: 'good' }),
        h(Metric, {
          label: 'חיבורים',
          value: platformEntries.length ? `${connectedPlatforms} מתוך ${platformEntries.length} מחוברים` : 'אין חיבורים מוגדרים',
          tone: connectedPlatforms ? 'good' : 'warn'
        }),
        h(Metric, {
          label: 'משימות',
          value: `${activeJobs.length} פעילות · ${pausedJobs.length} מושהות`,
          tone: activeJobs.length ? 'good' : 'warn'
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
      'האבחון המתקדם הוא המסך הרשמי של Hermes ואינו מעלה דבר אוטומטית. ZIP מצומצם ללא שיחות, מיילים או קבצי עסק זמין ב־launcher של ה־POC. אין במעטפת גישה מרחוק או backdoor.'
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

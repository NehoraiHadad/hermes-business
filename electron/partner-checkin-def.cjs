// The pure DEFINITION + job-shape layer for the partner check-in: the ownership
// marker, cadence presets, the unattended-run prompt, and the side-effect-free
// predicates/readers over a cron job (owned? paused? drifted? which cadence? what
// live schedule?). No cron store, no I/O — the stateful reconciliation that DRIVES
// the one official Hermes cron store lives in partner-checkins.cjs.

const { cronJobId } = require('./cron-identity.cjs')

// Stable ownership marker embedded in the job NAME (the only identity field the
// REST CronJobCreate contract accepts — no origin/metadata dict). The def id and
// cadence ride inside it so drift is detectable from the plain-string name.
const MARKER = 'hermes-business-partner-checkin'
const DEF_ID = 'brief'
const MARKER_RE = new RegExp(`\\[${MARKER}:([a-z0-9-]+):([a-z]+)\\]`)

// Cadence presets → real cron expressions + human labels, all at 08:00.
// TIMEZONE (verified from source): Hermes evaluates cron day/hour in its CONFIGURED
// timezone — hermes_time.now() resolves HERMES_TIMEZONE → config.yaml `timezone` →
// machine-local (cron/jobs.compute_next_run drives croniter off that clock). The
// official create/update payload carries NO per-job timezone field, so we invent
// none: an Israeli owner sets `timezone: Asia/Jerusalem` (or HERMES_TIMEZONE) once.
// WEEKDAYS = Israeli business week Sun–Thu: croniter is standard cron (0 = Sunday),
// so `0-4` is Sun–Thu — NOT the western Mon–Fri `1-5`. WEEKLY fires Sunday (`0`).
const CADENCE = {
  daily: { expr: '0 8 * * *', label: 'כל יום ב־08:00' },
  weekdays: { expr: '0 8 * * 0-4', label: 'ימים א׳–ה׳ ב־08:00' },
  weekly: { expr: '0 8 * * 0', label: 'כל יום ראשון ב־08:00' }
}

// Truthful unattended-run prompt: under cron there is no human to approve, so
// Hermes hard-blocks dangerous commands and execute_code (approvals.cron_mode
// deny). The check-in therefore only researches and drafts — never actuates.
const CHECKIN_PROMPT = [
  'את/ה השותף העסקי היזום בריצת צ׳ק־אין מתוזמנת (cron) ולא־מלווה: אין אדם נוכח לאשר,',
  'ולכן Hermes חוסם אוטומטית פקודות מסוכנות/הרסניות והרצת קוד. אל תשלח/י הודעות, אל',
  'תפרסם/י, אל תמחק/י, אל תבצע/י commit ואל תתחייב/י חיצונית. הפק/י תדריך קצר בלבד:',
  'מה נבדק, מה השתנה מאז הצ׳ק־אין הקודם, סיכונים והזדמנויות, וטיוטת המלצה עם צעד הפיך',
  'אחד קטן. סיים/י ברשימת הפעולות שממתינות לאישור מפורש של הבעלים כשיהיו נוכחים.'
].join(' ')

function cadenceOf(settings) {
  return CADENCE[settings.checkinCadence] ? settings.checkinCadence : 'weekly'
}

function checkinName(cadence) {
  return `צ׳ק־אין שותף עסקי · ${CADENCE[cadence].label} [${MARKER}:${DEF_ID}:${cadence}]`
}

// The desired check-in, or null when partner mode or the opt-in is off.
function desiredCheckin(settings) {
  if (!settings || settings.mode !== 'partner' || settings.checkins !== true) return null
  const cadence = cadenceOf(settings)
  return { cadence, name: checkinName(cadence), schedule: CADENCE[cadence].expr, prompt: CHECKIN_PROMPT, deliver: 'local' }
}

function isOwnedCheckin(job) {
  return Boolean(job && typeof job.name === 'string' && MARKER_RE.test(job.name))
}

function ownedCadence(job) {
  const match = MARKER_RE.exec(job.name || '')
  return match ? match[2] : null
}

function jobIsPaused(job) {
  return job.enabled === false || job.state === 'paused'
}

// The AUTHORITATIVE schedule as a comparable string, from either the plain string or the
// Hermes 0.19.1 kind-object ({kind:once,run_at} | {kind:cron,expr} | {kind:interval}).
function scheduleExpr(job) {
  const s = job && job.schedule
  if (typeof s === 'string') return s.trim()
  if (s && typeof s === 'object') {
    if (s.kind === 'once' && typeof s.run_at === 'string') return s.run_at
    if (s.kind === 'cron' && typeof s.expr === 'string') return s.expr
    if (s.kind === 'interval') return typeof s.display === 'string' ? s.display : (Number.isFinite(s.minutes) ? `every ${s.minutes}m` : '')
    return String(s.expr || s.run_at || s.display || '')
  }
  return typeof job.schedule_display === 'string' ? job.schedule_display : ''
}

function deliverOf(job) {
  return typeof job.deliver === 'string' && job.deliver ? job.deliver : 'local'
}

// Reverse-map a live cron expr to its friendly cadence label, or null if it is not one
// of our presets (i.e. it was edited to something else in full Hermes).
function cadenceLabelForExpr(expr) {
  for (const key of Object.keys(CADENCE)) if (CADENCE[key].expr === expr) return CADENCE[key].label
  return null
}

// Drift is measured against the FULL authoritative job — name/cadence marker, prompt,
// the live schedule expression AND the delivery target — not just the enabled flag or
// the marker. An edit made inside full Hermes (e.g. the cron time or deliver changed)
// is therefore detected and reconciled back to the intended check-in.
function checkinDrifted(job, desired) {
  const prompt = typeof job.prompt === 'string' ? job.prompt.trim() : ''
  return (
    ownedCadence(job) !== desired.cadence ||
    job.name !== desired.name ||
    prompt !== desired.prompt.trim() ||
    scheduleExpr(job) !== desired.schedule ||
    deliverOf(job) !== desired.deliver
  )
}

module.exports = {
  cronJobId,
  MARKER,
  DEF_ID,
  MARKER_RE,
  CADENCE,
  CHECKIN_PROMPT,
  cadenceOf,
  checkinName,
  desiredCheckin,
  isOwnedCheckin,
  ownedCadence,
  jobIsPaused,
  scheduleExpr,
  deliverOf,
  cadenceLabelForExpr,
  checkinDrifted
}

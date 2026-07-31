import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.env.HERMES_E2E_PORT || 9129)
const hermesHome =
  process.env.HERMES_HOME ||
  (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || '', 'hermes')
    : join(process.env.HOME || '', '.hermes'))
const hermes =
  process.env.HERMES_BIN ||
  (process.platform === 'win32'
    ? join(hermesHome, 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
    : join(hermesHome, 'hermes-agent', 'venv', 'bin', 'hermes'))

if (!existsSync(hermes)) {
  throw new Error(`Hermes executable was not found at ${hermes}`)
}

const token = randomBytes(32).toString('base64url')
const baseUrl = `http://127.0.0.1:${port}`
const wsUrl = `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`
const jobName = `POC E2E ${new Date().toISOString().replace(/[:.]/g, '-')}`
const expected = `HERMES_POC_STREAM_OK_${Date.now()}`
const sessionTitle = `POC E2E — shared session ${Date.now()}`
const runClarifyProbe = process.env.HERMES_E2E_CLARIFY === '1'

let server
let socket
let nextId = 0
let cronCreated = false
const pending = new Map()
const events = []
const serverOutput = []

function stage(message) {
  console.error(`[e2e] ${message}`)
}

function sanitize(value) {
  return String(value || '')
    .replace(/([?&](?:token|ticket)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,})\b/g, '<redacted>')
}

function flattenSkillNames(value) {
  if (Array.isArray(value)) return value.flatMap(flattenSkillNames)
  if (value && typeof value === 'object') {
    if (typeof value.name === 'string') return [value.name]
    return Object.values(value).flatMap(flattenSkillNames)
  }
  return typeof value === 'string' ? [value] : []
}

async function waitForHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.ok) return response.json()
      lastError = new Error(`Health returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw lastError || new Error('Hermes health check timed out')
}

function rpc(method, params = {}, timeoutMs = 180_000) {
  const id = `e2e-${++nextId}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`RPC timed out: ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

function waitForEvent(predicate, timeoutMs = 180_000) {
  const existing = events.find(predicate)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      const event = events.find(predicate)
      if (event) {
        clearInterval(timer)
        resolve(event)
      } else if (Date.now() >= deadline) {
        clearInterval(timer)
        reject(new Error('Gateway event timed out'))
      }
    }, 50)
  })
}

function stopServer() {
  if (!server?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(server.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } else {
    server.kill('SIGTERM')
  }
}

try {
  stage(`starting Hermes on 127.0.0.1:${port}`)
  server = spawn(hermes, ['serve', '--host', '127.0.0.1', '--port', String(port)], {
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      HERMES_DASHBOARD_SESSION_TOKEN: token,
      HERMES_DESKTOP: '1'
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  server.stdout.on('data', chunk => serverOutput.push(sanitize(chunk)))
  server.stderr.on('data', chunk => serverOutput.push(sanitize(chunk)))

  const health = await waitForHealth()
  stage('health endpoint is ready')

  socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 20_000)
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error('WebSocket connection failed'))
      },
      { once: true }
    )
    socket.addEventListener('message', message => {
      const frame = JSON.parse(String(message.data))
      if (frame.id != null) {
        const request = pending.get(String(frame.id))
        if (!request) return
        clearTimeout(request.timer)
        pending.delete(String(frame.id))
        if (frame.error) request.reject(new Error(frame.error.message || 'Hermes RPC failed'))
        else request.resolve(frame.result)
        return
      }
      if (frame.method === 'event' && frame.params?.type) events.push(frame.params)
    })
  })
  stage('WebSocket is connected')

  const readiness = await rpc('setup.runtime_check', {})
  if (!readiness?.ok && !readiness?.ready) {
    throw new Error(`Runtime is not ready: ${JSON.stringify(readiness)}`)
  }
  stage(`runtime is ready (${readiness.provider || 'provider configured'})`)

  const created = await rpc('session.create', {
    title: sessionTitle,
    source: 'desktop',
    cols: 96
  })
  const runtimeSessionId = created.session_id
  const storedSessionId = created.stored_session_id
  await rpc('session.title', { session_id: runtimeSessionId, title: sessionTitle })
  stage(`created shared session ${storedSessionId}`)

  const complete = waitForEvent(
    event => event.type === 'message.complete' && event.session_id === runtimeSessionId
  )
  await rpc('prompt.submit', {
    session_id: runtimeSessionId,
    text: `Reply with exactly: ${expected}. Do not call tools.`
  })
  const completedEvent = await complete
  stage('received message.complete')
  const deltas = events.filter(
    event => event.type === 'message.delta' && event.session_id === runtimeSessionId
  )
  const streamedText = deltas.map(event => String(event.payload?.text || '')).join('')
  const finalText = String(completedEvent.payload?.text || streamedText)
  if (!deltas.length) throw new Error('No message.delta streaming events were received')
  if (!`${streamedText}\n${finalText}`.includes(expected)) {
    throw new Error(`Unexpected model response: ${finalText || streamedText}`)
  }

  let clarifyProbe = null
  if (runClarifyProbe) {
    const requestEvent = waitForEvent(
      event => event.type === 'clarify.request' && event.session_id === runtimeSessionId
    )
    await rpc('prompt.submit', {
      session_id: runtimeSessionId,
      text:
        'Contract test: call the clarify tool now with the single open-ended question "What is the business name?". Do not answer it yourself.'
    })
    const clarifyEvent = await requestEvent
    const requestId = String(clarifyEvent.payload?.request_id || '')
    if (!requestId) throw new Error(`clarify.request has no request_id: ${JSON.stringify(clarifyEvent)}`)
    await rpc('clarify.respond', { request_id: requestId, answer: 'POC Business' })
    clarifyProbe = {
      request_id_present: true,
      question: clarifyEvent.payload?.question,
      response_accepted: true
    }
    await rpc('session.interrupt', { session_id: runtimeSessionId })
  }

  const listed = await rpc('session.list', { limit: 100 })
  const sharedSession = listed.sessions?.find(item => item.id === storedSessionId)
  if (!sharedSession) throw new Error('The new session was not returned by session.list')
  stage('shared session is visible through session.list')

  const skills = await rpc('skills.manage', { action: 'list' })
  const skillCount = new Set(flattenSkillNames(skills.skills || {})).size

  await rpc('cron.manage', {
    action: 'add',
    name: jobName,
    schedule: '0 0 1 1 *',
    prompt: 'POC E2E marker task. Do not run outside this acceptance test.'
  })
  cronCreated = true
  stage('created scheduled task')
  let cron = await rpc('cron.manage', { action: 'list' })
  const createdJob = cron.jobs?.find(item => item.name === jobName)
  if (!createdJob) throw new Error('The scheduled task was not returned by cron.manage list')
  const jobId = createdJob.id || createdJob.name
  await rpc('cron.manage', { action: 'pause', name: jobId })
  await rpc('cron.manage', { action: 'resume', name: jobId })
  await rpc('cron.manage', { action: 'remove', name: jobId })
  cronCreated = false
  cron = await rpc('cron.manage', { action: 'list' })
  if (cron.jobs?.some(item => item.name === jobName)) {
    throw new Error('The scheduled task remained after cleanup')
  }
  stage('completed cron create/pause/resume/remove cycle')

  console.log(
    JSON.stringify(
      {
        ok: true,
        health: health.status || health.ok || 'healthy',
        provider: readiness.provider || 'configured',
        model: readiness.model || 'configured',
        streaming: { delta_events: deltas.length, expected_marker_received: true },
        clarify: clarifyProbe,
        shared_session: {
          stored_session_id: storedSessionId,
          title: sharedSession.title,
          source: sharedSession.source
        },
        skills: { discovered: skillCount },
        cron: { create_pause_resume_remove: true }
      },
      null,
      2
    )
  )
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error))
  if (serverOutput.length) {
    console.error(serverOutput.slice(-20).join('').slice(-5000))
  }
  process.exitCode = 1
} finally {
  if (cronCreated && socket?.readyState === WebSocket.OPEN) {
    try {
      const cron = await rpc('cron.manage', { action: 'list' }, 15_000)
      const job = cron.jobs?.find(item => item.name === jobName)
      if (job) await rpc('cron.manage', { action: 'remove', name: job.id || job.name }, 15_000)
    } catch {
      // Best-effort cleanup after a failed assertion.
    }
  }
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error('E2E test shut down'))
  }
  pending.clear()
  socket?.close()
  stopServer()
}

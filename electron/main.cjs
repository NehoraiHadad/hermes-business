const { app, BrowserWindow, dialog, ipcMain, shell, Menu, Tray, nativeImage, screen } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const { createHash, randomBytes } = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const AdmZip = require('adm-zip')

const PREFERRED_PORT = 9119
const SESSION_TOKEN = randomBytes(32).toString('base64url')
let runtimePort = PREFERRED_PORT
const baseUrl = () => `http://127.0.0.1:${runtimePort}`
const wsUrl = () => `ws://127.0.0.1:${runtimePort}/api/ws?token=${encodeURIComponent(SESSION_TOKEN)}`

let mainWindow = null
let hermesProcess = null
let quitting = false
let tray = null
let windowMode = 'full'
let miniPinned = true
let normalBounds = null
let assistantHidden = false
let hiddenBounds = null
let miniPinTimer = null
let runtimeState = {
  installed: false,
  running: false,
  starting: false,
  mode: 'live',
  version: null,
  error: null,
  wsUrl: wsUrl()
}
const runtimeLogs = []

function hermesHome() {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'hermes')
  }
  return path.join(os.homedir(), '.hermes')
}

function windowPreferencesPath() {
  return path.join(app.getPath('userData'), 'window-preferences.json')
}

function loadWindowPreferences() {
  try {
    const value = JSON.parse(fs.readFileSync(windowPreferencesPath(), 'utf8'))
    windowMode = value.mode === 'mini' ? 'mini' : 'full'
    miniPinned = value.miniPinned !== false
    if (value.normalBounds && Number.isFinite(value.normalBounds.width) && Number.isFinite(value.normalBounds.height)) {
      normalBounds = value.normalBounds
    }
  } catch {
    // First run or an invalid preference file: use friendly defaults.
  }
}

function saveWindowPreferences() {
  try {
    fs.mkdirSync(path.dirname(windowPreferencesPath()), { recursive: true })
    fs.writeFileSync(
      windowPreferencesPath(),
      JSON.stringify({ mode: windowMode, miniPinned, normalBounds }, null, 2),
      'utf8'
    )
  } catch (error) {
    rememberLog(`Could not save window preferences: ${error.message || error}`)
  }
}

function currentWindowState() {
  return {
    mode: windowMode,
    alwaysOnTop:
      windowMode === 'mini' && mainWindow && !mainWindow.isDestroyed()
        ? mainWindow.isAlwaysOnTop()
        : false,
    visible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !assistantHidden)
  }
}

function applyMiniPin() {
  if (!mainWindow || mainWindow.isDestroyed() || windowMode !== 'mini') return
  if (miniPinTimer) {
    clearTimeout(miniPinTimer)
    miniPinTimer = null
  }
  if (!miniPinned) {
    mainWindow.setAlwaysOnTop(false)
    return
  }
  // On Windows an Electron window created as always-on-top can occasionally
  // report false until the native flag is toggled once after the window is
  // visible. Reassert through false -> true and report the actual native state.
  if (!mainWindow.isAlwaysOnTop()) mainWindow.setAlwaysOnTop(false)
  mainWindow.setAlwaysOnTop(true, 'normal')
  const target = mainWindow
  miniPinTimer = setTimeout(() => {
    miniPinTimer = null
    if (!target || target.isDestroyed() || target !== mainWindow || windowMode !== 'mini' || !miniPinned) return
    if (!target.isAlwaysOnTop()) {
      target.setAlwaysOnTop(false)
      target.setAlwaysOnTop(true, 'normal')
    }
  }, 150)
}

function refreshWindowSurface() {
  const target = mainWindow
  setTimeout(() => {
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return
    target.webContents.invalidate()
  }, 60)
}

function setWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return currentWindowState()
  const nextMode = mode === 'mini' ? 'mini' : 'full'
  if (nextMode === windowMode) {
    mainWindow.show()
    mainWindow.focus()
    if (nextMode === 'mini') applyMiniPin()
    refreshWindowSurface()
    return currentWindowState()
  }
  if (nextMode === 'mini') {
    const enteringMini = windowMode !== 'mini'
    if (enteringMini) normalBounds = mainWindow.getBounds()
    windowMode = 'mini'
    mainWindow.setSkipTaskbar(true)
    mainWindow.setMinimumSize(340, 440)
    mainWindow.setMaximumSize(620, 900)
    mainWindow.setMaximizable(false)
    if (enteringMini) {
      const workArea = screen.getDisplayMatching(mainWindow.getBounds()).workArea
      const width = Math.min(390, workArea.width)
      const height = Math.min(640, workArea.height)
      mainWindow.setBounds({
        x: workArea.x + workArea.width - width - 18,
        y: workArea.y + workArea.height - height - 18,
        width,
        height
      })
    }
  } else {
    windowMode = 'full'
    mainWindow.setSkipTaskbar(false)
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setMaximumSize(0, 0)
    mainWindow.setMinimumSize(1100, 720)
    mainWindow.setMaximizable(true)
    if (normalBounds) mainWindow.setBounds(normalBounds)
    else {
      mainWindow.setSize(1440, 920)
      mainWindow.center()
    }
  }
  mainWindow.show()
  mainWindow.focus()
  if (nextMode === 'mini') applyMiniPin()
  refreshWindowSurface()
  saveWindowPreferences()
  return currentWindowState()
}

function setMiniPinned(value) {
  miniPinned = Boolean(value)
  if (mainWindow && !mainWindow.isDestroyed() && windowMode === 'mini') {
    applyMiniPin()
  }
  saveWindowPreferences()
  return currentWindowState()
}

function showAssistant(mode = windowMode) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  assistantHidden = false
  if (hiddenBounds) {
    mainWindow.setBounds(hiddenBounds)
    hiddenBounds = null
  }
  mainWindow.setIgnoreMouseEvents(false)
  if (mainWindow.isMinimized()) mainWindow.restore()
  setWindowMode(mode)
  mainWindow.show()
  mainWindow.focus()
}

function hideAssistant() {
  if (!mainWindow || mainWindow.isDestroyed()) return currentWindowState()
  assistantHidden = true
  if (miniPinTimer) {
    clearTimeout(miniPinTimer)
    miniPinTimer = null
  }
  hiddenBounds = mainWindow.getBounds()
  const workArea = screen.getDisplayMatching(hiddenBounds).workArea
  mainWindow.setAlwaysOnTop(false)
  mainWindow.setIgnoreMouseEvents(true)
  mainWindow.setPosition(workArea.x + workArea.width + 100, workArea.y, false)
  mainWindow.blur()
  return currentWindowState()
}

function createTray() {
  if (tray) return
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icon.png'))
  tray = new Tray(icon.resize({ width: 20, height: 20 }))
  tray.setToolTip('העוזר לעסק')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'פתח את העוזר', click: () => showAssistant(windowMode) },
      { label: 'צ׳אט קטן', click: () => showAssistant('mini') },
      { label: 'חלון מלא', click: () => showAssistant('full') },
      { type: 'separator' },
      { label: 'יציאה', click: () => app.quit() }
    ])
  )
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && !assistantHidden) hideAssistant()
    else showAssistant(windowMode)
  })
}

function rememberLog(raw) {
  const line = redact(String(raw || '').trim())
  if (!line) return
  runtimeLogs.push(`${new Date().toISOString()} ${line}`)
  if (runtimeLogs.length > 600) runtimeLogs.shift()
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('hermes:runtime-log', line)
  }
}

function redact(value) {
  return value
    .replace(/([?&](?:token|ticket)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1<redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|\d{7,}:[A-Za-z0-9_-]{20,})\b/g, '<redacted>')
    .replace(/("(?:api_key|token|secret|password)"\s*:\s*")[^"]+(")/gi, '$1<redacted>$2')
}

function findHermes() {
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['hermes'], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (probe.status === 0) {
    const first = probe.stdout.split(/\r?\n/).find(Boolean)
    if (first) return first.trim()
  }

  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'hermes', 'bin', 'hermes.exe'),
        path.join(os.homedir(), '.local', 'bin', 'hermes.exe'),
        path.join(os.homedir(), '.local', 'bin', 'hermes.cmd')
      ]
    : [path.join(os.homedir(), '.local', 'bin', 'hermes')]

  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null
}

function getHermesVersion(command) {
  if (!command) return null
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true })
  const output = `${result.stdout || ''} ${result.stderr || ''}`.trim()
  return output || null
}

async function waitForHealth(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl()}/api/health`, {
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` }
      })
      if (response.ok) return await response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 600))
  }
  throw lastError || new Error('Hermes did not become ready')
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function chooseRuntimePort() {
  for (let candidate = PREFERRED_PORT; candidate < PREFERRED_PORT + 80; candidate += 1) {
    if (await isPortAvailable(candidate)) return candidate
  }
  throw new Error('No private local port is available for the Hermes companion')
}

async function startHermes() {
  if (runtimeState.running) return runtimeState
  if (runtimeState.starting) {
    const deadline = Date.now() + 50_000
    while (runtimeState.starting && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return runtimeState
  }
  const command = findHermes()
  runtimeState = {
    ...runtimeState,
    installed: Boolean(command),
    version: getHermesVersion(command),
    starting: Boolean(command),
    error: null
  }
  if (!command) return runtimeState

  runtimePort = await chooseRuntimePort()
  runtimeState = { ...runtimeState, wsUrl: wsUrl() }
  const env = {
    ...process.env,
    HERMES_DASHBOARD_SESSION_TOKEN: SESSION_TOKEN,
    HERMES_DESKTOP: '1'
  }
  // `hermes serve` is headless by definition. Current Hermes versions do not
  // expose a `--no-open` flag, so passing it makes the managed runtime exit
  // before the health check can ever succeed.
  hermesProcess = spawn(command, ['serve', '--host', '127.0.0.1', '--port', String(runtimePort)], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  hermesProcess.stdout.on('data', chunk => rememberLog(chunk))
  hermesProcess.stderr.on('data', chunk => rememberLog(chunk))
  hermesProcess.on('exit', code => {
    rememberLog(`Hermes exited (${code ?? 'unknown'})`)
    hermesProcess = null
    runtimeState = { ...runtimeState, running: false, starting: false }
  })

  try {
    await waitForHealth()
    runtimeState = { ...runtimeState, running: true, starting: false }
  } catch (error) {
    runtimeState = { ...runtimeState, running: false, starting: false, error: String(error.message || error) }
  }
  return runtimeState
}

async function stopHermes() {
  if (!hermesProcess) return
  const proc = hermesProcess
  hermesProcess = null
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
  } else {
    proc.kill('SIGTERM')
  }
  runtimeState = { ...runtimeState, running: false, starting: false }
}

async function hermesApi(endpoint, init = {}) {
  if (!runtimeState.running) await startHermes()
  if (!runtimeState.running) throw new Error(runtimeState.error || 'Hermes is not running')
  const headers = {
    Authorization: `Bearer ${SESSION_TOKEN}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {})
  }
  const response = await fetch(`${baseUrl()}${endpoint}`, {
    method: init.method || 'GET',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Hermes returned HTTP ${response.status}`)
  }
  return payload
}

function safeWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  fs.copyFileSync(temporary, filePath)
  fs.unlinkSync(temporary)
}

function stageBusinessBootstrap() {
  const packagedRoot = path.join(process.resourcesPath, 'business-bootstrap')
  const sourceRoot = app.isPackaged ? packagedRoot : path.join(__dirname, '..')
  const sources = app.isPackaged
    ? {
        script: path.join(sourceRoot, 'bootstrap.ps1'),
        plugin: path.join(sourceRoot, 'plugin.js'),
        skill: path.join(sourceRoot, 'business-bootstrap.SKILL.md')
      }
    : {
        script: path.join(sourceRoot, 'installer', 'bootstrap.ps1'),
        plugin: path.join(sourceRoot, 'hermes-plugin', 'business-shell', 'plugin.js'),
        skill: path.join(
          sourceRoot,
          'hermes-plugin',
          'business-shell',
          'skills',
          'business-bootstrap',
          'SKILL.md'
        )
      }
  for (const [name, source] of Object.entries(sources)) {
    if (!fs.existsSync(source)) throw new Error(`The packaged ${name} payload is missing`)
  }
  const stagingRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'hermes-business-bootstrap-'))
  fs.copyFileSync(sources.script, path.join(stagingRoot, 'bootstrap.ps1'))
  fs.copyFileSync(sources.plugin, path.join(stagingRoot, 'plugin.js'))
  fs.copyFileSync(sources.skill, path.join(stagingRoot, 'business-bootstrap.SKILL.md'))
  return stagingRoot
}

function desktopPluginSource() {
  return path.join(__dirname, '..', 'hermes-plugin', 'business-shell', 'plugin.js')
}

function bootstrapSkillSource() {
  return path.join(
    __dirname,
    '..',
    'hermes-plugin',
    'business-shell',
    'skills',
    'business-bootstrap',
    'SKILL.md'
  )
}

function installDesktopPlugin() {
  const source = desktopPluginSource()
  const skillSource = bootstrapSkillSource()
  if (!fs.existsSync(source) || !fs.existsSync(skillSource)) {
    return { ok: false, error: 'Bundled Desktop Plugin or bootstrap Skill is missing' }
  }
  const targetDir = path.join(hermesHome(), 'desktop-plugins', 'business-shell')
  const target = path.join(targetDir, 'plugin.js')
  const content = fs.readFileSync(source)
  const skillContent = fs.readFileSync(skillSource)
  const skillTarget = path.join(hermesHome(), 'skills', 'productivity', 'business-bootstrap', 'SKILL.md')
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(target, content, { mode: 0o600 })
  fs.mkdirSync(path.dirname(skillTarget), { recursive: true })
  fs.writeFileSync(skillTarget, skillContent, { mode: 0o600 })
  const integrity = `sha256-${createHash('sha256').update(content).digest('base64')}`
  const skillIntegrity = `sha256-${createHash('sha256').update(skillContent).digest('base64')}`
  safeWrite(
    path.join(targetDir, 'install-receipt.json'),
    `${JSON.stringify(
      {
        id: 'business-shell',
        installedAt: new Date().toISOString(),
        integrity,
        bootstrapSkill: skillTarget,
        bootstrapSkillIntegrity: skillIntegrity
      },
      null,
      2
    )}\n`
  )
  return { ok: true, target, integrity, bootstrapSkill: skillTarget, bootstrapSkillIntegrity: skillIntegrity }
}

async function googleSetupPaths() {
  const root = hermesHome()
  const hermesCommand = findHermes()
  const pythonCandidates = process.platform === 'win32'
    ? [
        hermesCommand ? path.join(path.dirname(hermesCommand), 'python.exe') : '',
        path.join(root, 'hermes-agent', 'venv', 'Scripts', 'python.exe')
      ]
    : [
        hermesCommand ? path.join(path.dirname(hermesCommand), 'python') : '',
        path.join(root, 'hermes-agent', 'venv', 'bin', 'python')
      ]
  let discoveredSkillRoot = ''
  try {
    const skill = await hermesApi('/api/skills/content?name=google-workspace&profile=default')
    if (typeof skill?.path === 'string') discoveredSkillRoot = path.dirname(skill.path)
  } catch {
    // Older compatible Hermes builds may not expose Skill content over HTTP.
  }
  const candidates = [
    discoveredSkillRoot ? path.join(discoveredSkillRoot, 'scripts', 'setup.py') : '',
    path.join(root, 'skills', 'productivity', 'google-workspace', 'scripts', 'setup.py'),
    path.join(root, 'hermes-agent', 'skills', 'productivity', 'google-workspace', 'scripts', 'setup.py')
  ]
  return {
    python: pythonCandidates.find(candidate => candidate && fs.existsSync(candidate)),
    script: candidates.find(candidate => candidate && fs.existsSync(candidate))
  }
}

function runCaptured(command, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: { ...process.env, HERMES_HOME: hermesHome() } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('The setup step timed out'))
    }, timeout)
    child.stdout.on('data', chunk => {
      stdout += chunk
      rememberLog(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      rememberLog(chunk)
    })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(redact(stderr || stdout || `Setup exited with code ${code}`)))
    })
  })
}

async function ensureGatewayBackground(command = findHermes()) {
  if (!command) return { ok: false, installed: false }
  let probe
  try {
    probe = await runCaptured(command, ['gateway', 'status'], 45_000)
  } catch (error) {
    rememberLog(`Gateway status check failed: ${error.message || error}`)
    probe = { stdout: '', stderr: '' }
  }
  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`
  const running = /gateway (?:process )?running|gateway is running/i.test(output)
  const startsOnLogin = /login item installed|scheduled task (?:installed|registered)/i.test(output)
  if (running && startsOnLogin) {
    return { ok: true, installed: true, running: true }
  }

  await runCaptured(command, ['gateway', 'install', '--start-now', '--start-on-login'], 180_000)
  return { ok: true, installed: true, running: true }
}

function parseJsonOutput(output) {
  const lines = output.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    try {
      return JSON.parse(line)
    } catch {
      // Keep scanning; setup scripts may print status lines before JSON.
    }
  }
  const start = output.lastIndexOf('{')
  if (start >= 0) {
    try {
      return JSON.parse(output.slice(start))
    } catch {
      return null
    }
  }
  return null
}

async function startGoogleSetup(clientSecretPath, services = 'all') {
  const { python, script } = await googleSetupPaths()
  if (!script || !python || !fs.existsSync(python)) throw new Error('Google Workspace skill is not available in this Hermes install')
  await runCaptured(python, [script, '--client-secret', clientSecretPath])
  const result = await runCaptured(python, [script, '--auth-url', '--services', services, '--format', 'json'])
  const payload = parseJsonOutput(result.stdout)
  const authUrl = payload?.auth_url
  if (!authUrl) throw new Error('Hermes did not return a Google authorization URL')
  await shell.openExternal(authUrl)
  return { ok: true, authUrl }
}

async function finishGoogleSetup(code) {
  const { python, script } = await googleSetupPaths()
  if (!script || !python || !fs.existsSync(python)) throw new Error('Google Workspace skill is not available in this Hermes install')
  const result = await runCaptured(python, [script, '--auth-code', code, '--format', 'json'])
  const payload = parseJsonOutput(result.stdout) || {}
  const check = await runCaptured(python, [script, '--check'])
  const authenticated = /AUTHENTICATED/i.test(check.stdout)
  if (!authenticated) throw new Error('Google authorization was not completed')
  return { ok: true, ...payload }
}

async function getGoogleStatus() {
  const { python, script } = await googleSetupPaths()
  if (!script || !python || !fs.existsSync(python)) {
    return { available: false, authenticated: false }
  }
  try {
    const result = await runCaptured(python, [script, '--check'], 45_000)
    return {
      available: true,
      authenticated: /^AUTHENTICATED(?:\s|:|$)/im.test(result.stdout)
    }
  } catch {
    // The official setup script exits non-zero for NOT_AUTHENTICATED.
    return { available: true, authenticated: false }
  }
}

async function createDiagnosticsBundle() {
  const versions = await getVersions()
  let health = null
  let status = null
  try {
    health = await hermesApi('/api/health')
    status = await hermesApi('/api/status')
  } catch (error) {
    health = { ok: false, error: String(error.message || error) }
  }

  const safeHealth = health
    ? {
        ok: Boolean(health.ok),
        version: typeof health.version === 'string' ? health.version : null,
        auth_required: Boolean(health.auth_required)
      }
    : null
  const safeComponents = Object.fromEntries(
    Object.entries(status?.components || {}).map(([name, component]) => [
      name,
      {
        status: typeof component?.status === 'string' ? component.status : null,
        state: typeof component?.state === 'string' ? component.state : null,
        configured: Number.isFinite(component?.configured) ? component.configured : null,
        connected: Number.isFinite(component?.connected) ? component.connected : null
      }
    ])
  )
  const safeStatus = status
    ? {
        version: typeof status.version === 'string' ? status.version : null,
        release_date: typeof status.release_date === 'string' ? status.release_date : null,
        config_version: status.config_version ?? null,
        latest_config_version: status.latest_config_version ?? null,
        can_update_hermes: Boolean(status.can_update_hermes),
        gateway_running: Boolean(status.gateway_running),
        gateway_state: typeof status.gateway_state === 'string' ? status.gateway_state : null,
        gateway_busy: Boolean(status.gateway_busy),
        gateway_drainable: Boolean(status.gateway_drainable),
        active_agents: Number.isFinite(status.active_agents) ? status.active_agents : null,
        active_sessions: Number.isFinite(status.active_sessions) ? status.active_sessions : null,
        auth_required: Boolean(status.auth_required),
        nous_session_valid:
          typeof status.nous_session_valid === 'string' ? status.nous_session_valid : null,
        overall: typeof status.overall === 'string' ? status.overall : null,
        components: safeComponents
      }
    : null

  const manifest = {
    created_at: new Date().toISOString(),
    privacy: 'No API keys, tokens, conversation content, email content, business files, or customer data are included.',
    platform: { type: os.type(), release: os.release(), arch: os.arch() },
    versions,
    runtime: {
      installed: runtimeState.installed,
      running: runtimeState.running,
      starting: runtimeState.starting,
      mode: runtimeState.mode,
      error_present: Boolean(runtimeState.error)
    },
    health: safeHealth,
    status: safeStatus
  }
  const zip = new AdmZip()
  zip.addFile('diagnostics.json', Buffer.from(JSON.stringify(manifest, null, 2)))
  zip.addFile(
    'README.txt',
    Buffer.from(
      [
        'Hermes Business diagnostic bundle',
        '',
        'This bundle intentionally contains only an allow-listed runtime summary.',
        'Raw logs are excluded because they may contain conversation or business content.',
        'No API keys, tokens, email content, chat content, business files, customer data, or secrets are included.'
      ].join('\n')
    )
  )
  const defaultName = `hermes-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'שמירת חבילת אבחון',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'ZIP', extensions: ['zip'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  zip.writeZip(result.filePath)
  return { ok: true, path: result.filePath }
}

async function getVersions() {
  const command = findHermes()
  return {
    shell: app.getVersion(),
    hermes: getHermesVersion(command) || 'לא מותקן',
    electron: process.versions.electron,
    node: process.versions.node
  }
}

function registerIpc() {
  ipcMain.handle('hermes:runtime', async () => {
    const command = findHermes()
    runtimeState = { ...runtimeState, installed: Boolean(command), version: getHermesVersion(command) }
    return runtimeState
  })
  ipcMain.handle('hermes:start', startHermes)
  ipcMain.handle('hermes:restart', async () => {
    await stopHermes()
    return startHermes()
  })
  ipcMain.handle('hermes:api', (_event, endpoint, init) => hermesApi(endpoint, init))
  ipcMain.handle('hermes:versions', getVersions)
  ipcMain.handle('hermes:logs', () => ({ lines: runtimeLogs.slice(-250) }))
  ipcMain.handle('hermes:diagnostics', createDiagnosticsBundle)
  ipcMain.handle('hermes:choose-file', async (_event, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: filters || [] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('hermes:google:start', (_event, clientSecretPath, services) =>
    startGoogleSetup(clientSecretPath, services)
  )
  ipcMain.handle('hermes:google:finish', (_event, code) => finishGoogleSetup(code))
  ipcMain.handle('hermes:google:status', getGoogleStatus)
  ipcMain.handle('hermes:open-external', (_event, url) => shell.openExternal(url))
  ipcMain.handle('hermes:open-full', async (_event, surface) => {
    const command = findHermes()
    if (surface === 'desktop' && command) {
      const child = spawn(command, ['desktop'], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      return { ok: true }
    }
    if (surface === 'logs') {
      const logPath = path.join(hermesHome(), 'logs')
      fs.mkdirSync(logPath, { recursive: true })
      await shell.openPath(logPath)
      return { ok: true }
    }
    if (surface === 'settings') {
      await shell.openExternal(`${baseUrl()}/settings`)
      return { ok: true }
    }
    await shell.openExternal(baseUrl())
    return { ok: true }
  })
  ipcMain.handle('hermes:install', async () => {
    if (findHermes()) {
      installDesktopPlugin()
      await ensureGatewayBackground()
      return { ok: true, installed: true }
    }
    const stagingRoot = stageBusinessBootstrap()
    try {
      await runCaptured(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', path.join(stagingRoot, 'bootstrap.ps1'),
          '-PayloadRoot', stagingRoot,
          '-NoLaunch'
        ],
        45 * 60_000
      )
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true })
    }
    const installed = Boolean(findHermes())
    return { ok: installed, installed, code: installed ? 0 : 1 }
  })
  ipcMain.handle('assistant:window-state', () => currentWindowState())
  ipcMain.handle('assistant:set-window-mode', (_event, mode) => setWindowMode(mode))
  ipcMain.handle('assistant:set-always-on-top', (_event, value) => setMiniPinned(value))
  ipcMain.handle('assistant:hide', () => hideAssistant())
}

function createWindow() {
  const mini = windowMode === 'mini'
  const miniWorkArea = mini ? screen.getPrimaryDisplay().workArea : null
  const miniWidth = mini ? Math.min(390, miniWorkArea.width) : null
  const miniHeight = mini ? Math.min(640, miniWorkArea.height) : null
  mainWindow = new BrowserWindow({
    width: mini ? miniWidth : normalBounds?.width || 1440,
    height: mini ? miniHeight : normalBounds?.height || 920,
    x: mini ? miniWorkArea.x + miniWorkArea.width - miniWidth - 18 : normalBounds?.x,
    y: mini ? miniWorkArea.y + miniWorkArea.height - miniHeight - 18 : normalBounds?.y,
    minWidth: mini ? 340 : 1100,
    minHeight: mini ? 440 : 720,
    maxWidth: mini ? 620 : undefined,
    maxHeight: mini ? 900 : undefined,
    maximizable: !mini,
    alwaysOnTop: mini && miniPinned,
    skipTaskbar: mini,
    show: false,
    backgroundColor: '#f7f5ef',
    title: 'העוזר לעסק',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f7f5ef', symbolColor: '#27241f', height: 46 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.on('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show()
    mainWindow.focus()
    if (windowMode === 'mini') applyMiniPin()
    refreshWindowSurface()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (windowMode !== 'mini') return
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || windowMode !== 'mini') return
      applyMiniPin()
    }, 500)
  })
  mainWindow.on('close', event => {
    if (quitting) return
    event.preventDefault()
    hideAssistant()
  })
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173')
  }
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showAssistant(windowMode)
  })
}

app.whenReady().then(async () => {
  if (!singleInstance) return
  loadWindowPreferences()
  registerIpc()
  installDesktopPlugin()
  createWindow()
  createTray()
  try {
    await ensureGatewayBackground()
  } catch (error) {
    rememberLog(`Gateway background setup failed: ${error.message || error}`)
  }
  await startHermes()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // The assistant remains available from the system tray until the user
  // explicitly chooses "יציאה".
})

app.on('before-quit', event => {
  if (quitting) return
  quitting = true
  if (hermesProcess) {
    event.preventDefault()
    void stopHermes().finally(() => app.quit())
  }
})

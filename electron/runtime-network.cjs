const net = require('node:net')
const { authHeaders } = require('./hermes-auth.cjs')

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

async function chooseRuntimePort(preferredPort, range = 80) {
  for (let candidate = preferredPort; candidate < preferredPort + range; candidate += 1) {
    if (await isPortAvailable(candidate)) return candidate
  }
  throw new Error('No private local port is available for the Hermes companion')
}

async function waitForHealth({ baseUrl, token, timeoutMs = 45_000 }) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: authHeaders(token)
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

module.exports = { chooseRuntimePort, waitForHealth }

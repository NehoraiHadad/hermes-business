function parseUrl(candidate) {
  try {
    return new URL(String(candidate))
  } catch {
    return null
  }
}

function isAllowedExternalUrl(candidate) {
  const parsed = parseUrl(candidate)
  return parsed?.protocol === 'https:'
}

function isTrustedRendererUrl(candidate, packaged) {
  const parsed = parseUrl(candidate)
  if (!parsed) return false
  if (packaged) return parsed.protocol === 'file:'
  return (
    parsed.protocol === 'http:' &&
    parsed.hostname === '127.0.0.1' &&
    parsed.port === '5173'
  )
}

module.exports = { isAllowedExternalUrl, isTrustedRendererUrl }

const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')

const directoryPath = () => path.join(hermesHome(), 'channel_directory.json')

function sourceType(entry) {
  const id = String(entry?.id || '').toLowerCase()
  const type = String(entry?.type || '').toLowerCase()
  return type === 'group' || id.endsWith('@g.us') ? 'group' : 'dm'
}

function normalizeSource(entry, platform = 'whatsapp') {
  const id = String(entry?.id || '').trim()
  if (!id) return null
  const name = String(entry?.name || '').trim()
  return {
    id,
    name: name && name !== id ? name : sourceType(entry) === 'group' ? 'קבוצת WhatsApp' : 'שיחת WhatsApp',
    type: sourceType(entry),
    platform
  }
}

function readWhatsappDirectory(options = {}) {
  const file = options.file || directoryPath()
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const unique = new Map()
    for (const platform of ['whatsapp', 'whatsapp_cloud']) {
      const rows = parsed?.platforms?.[platform]
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        const source = normalizeSource(row, platform)
        if (source) unique.set(`${platform}:${source.id}`, source)
      }
    }
    return [...unique.values()].sort((a, b) =>
      a.platform.localeCompare(b.platform) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'he')
    )
  } catch {
    return []
  }
}

module.exports = { directoryPath, normalizeSource, readWhatsappDirectory }

// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = JSON.parse(readFileSync(path.join(ROOT, 'release-ledger.json'), 'utf8'))

// The download button is the ONLY way a first-time visitor gets the product, and
// it is the one surface with no build step, no types and no other test — an
// endpoint that quietly stops resolving there is invisible until someone tries
// to install. That is exactly what happened: the page called
// `/releases/latest`, GitHub defines "latest" as the newest NON-prerelease,
// every Tachles release is a prerelease, so the API answered 404 (the version
// label never appeared, silently by design) and the button 302'd to the bare
// releases list. Nothing looked broken. These tests run the page's real inline
// script against a stubbed feed and assert where the button actually points.

const HTML = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8')
const DOWNLOAD = 'https://github.com/NehoraiHadad/hermes-business/releases/download'

function release(tag, { assets = [`Tachles-Setup-${tag.replace(/^v/, '')}.exe`], draft = false } = {}) {
  return {
    tag_name: tag,
    draft,
    prerelease: tag.includes('-'),
    assets: assets.map(name => ({ name, browser_download_url: `${DOWNLOAD}/${tag}/${name}` }))
  }
}

/** Load the page with a stubbed global fetch and let its inline script run. */
async function renderWith(fetchImpl) {
  // 'outside-only' gives us window.eval WITHOUT auto-running the page's inline
  // scripts at parse time. With 'dangerously' the script would fire once against
  // the REAL fetch (a live network call from a unit test) and again against the
  // stub, and whichever resolved last would decide the assertion — a race that
  // passes today and flakes later.
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', pretendToBeVisual: true })
  dom.window.fetch = fetchImpl
  const scripts = [...dom.window.document.querySelectorAll('script')]
  const inline = scripts.map(s => s.textContent).find(t => t && t.includes('pickLatest'))
  expect(inline, 'the page must still carry the release-picking script').toBeTruthy()
  dom.window.eval(inline)
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
  return dom.window.document
}

const ok = payload => async () => ({ ok: true, json: async () => payload })

describe('site download button', () => {
  it('never links to /releases/latest — it excludes prereleases, which is all we ship', () => {
    const hrefs = [...HTML.matchAll(/href="(https:\/\/github\.com[^"]*)"/g)].map(m => m[1])
    expect(hrefs.filter(h => h.endsWith('/releases/latest'))).toEqual([])
    // ...and the script must not request that endpoint either.
    expect(HTML).not.toMatch(/fetch\([^)]*releases\/latest/)
  })

  it('points at the actual .exe of the highest published version', async () => {
    const doc = await renderWith(ok([release('v0.4.0-alpha.8'), release('v0.4.0-alpha.10'), release('v0.4.0-alpha.9')]))
    const btn = doc.getElementById('download-btn')
    expect(btn.href).toBe(`${DOWNLOAD}/v0.4.0-alpha.10/Tachles-Setup-0.4.0-alpha.10.exe`)
    expect(btn.textContent.trim()).toContain('0.4.0-alpha.10')
    expect(doc.getElementById('download-version').hidden).toBe(false)
  })

  it('orders prereleases NUMERICALLY — alpha.10 is newer than alpha.9', async () => {
    // A string compare puts alpha.10 below alpha.9 and would hand a visitor the
    // older build. This is the same defect that was found in the installer's own
    // SemVer comparator; it must not be reintroduced here.
    const doc = await renderWith(ok([release('v0.4.0-alpha.9'), release('v0.4.0-alpha.10')]))
    expect(doc.getElementById('download-btn').href).toContain('alpha.10')
  })

  it('does not depend on the order GitHub returns', async () => {
    const feed = [release('v0.4.0-alpha.9'), release('v0.4.0-alpha.10'), release('v0.4.0-alpha.8')]
    const forward = await renderWith(ok(feed))
    const reversed = await renderWith(ok(feed.slice().reverse()))
    expect(forward.getElementById('download-btn').href).toBe(reversed.getElementById('download-btn').href)
  })

  it('prefers a stable release over its own prereleases', async () => {
    const doc = await renderWith(ok([release('v1.0.0-alpha.3'), release('v1.0.0')]))
    expect(doc.getElementById('download-btn').href).toContain('/v1.0.0/')
  })

  it('skips drafts and releases carrying no installer', async () => {
    const doc = await renderWith(
      ok([
        release('v0.4.0-alpha.9'),
        release('v0.4.0-alpha.11', { draft: true }),
        release('v0.4.0-alpha.10', { assets: ['update-manifest.json'] })
      ])
    )
    // Neither of the newer entries is something a visitor could install, so the
    // button must not point at them and must fall back to what IS downloadable.
    expect(doc.getElementById('download-btn').href).toContain('/v0.4.0-alpha.9/')
  })

  it('upgrades EVERY download button, not only the one in the download section', async () => {
    // The nav and hero buttons were left behind when this was first written
    // against a single id: two of the three still went to the release list even
    // when the fetch succeeded. A visitor clicking the nav button is asking for
    // the same thing as one clicking the big one.
    const doc = await renderWith(ok([release('v0.4.0-alpha.10')]))
    const buttons = [...doc.querySelectorAll('[data-download-installer]')]
    expect(buttons.length).toBe(3)
    for (const button of buttons) {
      expect(button.href).toBe(`${DOWNLOAD}/v0.4.0-alpha.10/Tachles-Setup-0.4.0-alpha.10.exe`)
    }
  })

  it('does not turn the footer "Releases" link into a download', async () => {
    // That link goes to the releases page BY NAME. Pointing it at a file would
    // be a lie about where it leads, so it deliberately carries no marker.
    const doc = await renderWith(ok([release('v0.4.0-alpha.10')]))
    const footer = [...doc.querySelectorAll('a')].find(a => a.textContent.trim() === 'Releases')
    expect(footer).toBeTruthy()
    expect(footer.hasAttribute('data-download-installer')).toBe(false)
    expect(footer.href).toBe('https://github.com/NehoraiHadad/hermes-business/releases')
  })

  it('hands over a real installer with NO javascript at all', async () => {
    // The whole point of the static href. api.github.com allows 60
    // unauthenticated requests per hour PER IP, so a few people behind one
    // office NAT can exhaust it between them; before this, every one of them was
    // handed a release list instead of a download.
    const doc = new JSDOM(HTML).window.document
    for (const button of doc.querySelectorAll('[data-download-installer]')) {
      expect(button.getAttribute('href')).toMatch(/\/releases\/download\/v[^/]+\/Tachles-Setup-.+\.exe$/)
    }
    // ...and the footnote must describe THAT, not the old redirect behaviour.
    expect(doc.getElementById('download-note').textContent).toContain('מתחילה מיד')
  })

  it('pins the static href to the newest PUBLISHED release in release-ledger.json', () => {
    // The ledger is the record of what actually shipped (RELEASING.md step 10),
    // so it is the only honest offline source for "which installer exists". This
    // is what stops the static fallback from silently rotting: cut a release,
    // forget the site, and this fails.
    const newest = Object.keys(LEDGER.entries).sort(compareSemver).pop()
    const expected = `${DOWNLOAD}/v${newest}/Tachles-Setup-${newest}.exe`
    const doc = new JSDOM(HTML).window.document
    const hrefs = [...doc.querySelectorAll('[data-download-installer]')].map(a => a.getAttribute('href'))
    expect(hrefs.length).toBe(3)
    for (const href of hrefs) expect(href).toBe(expected)
  })

  it('leaves the static installer links alone when GitHub cannot be reached', async () => {
    // Rate limit, offline, blocked. The page must degrade to something that
    // still downloads the product - never to a dead button, and never to a list.
    const newest = Object.keys(LEDGER.entries).sort(compareSemver).pop()
    const staticHref = `${DOWNLOAD}/v${newest}/Tachles-Setup-${newest}.exe`
    for (const failing of [async () => ({ ok: false, status: 403, json: async () => ({}) }), async () => { throw new Error('offline') }]) {
      const doc = await renderWith(failing)
      expect(doc.getElementById('download-btn').href).toBe(staticHref)
      expect(doc.getElementById('download-version').hidden).toBe(true)
    }
  })

  it('ignores a malformed payload rather than writing junk into the button', async () => {
    const newest = Object.keys(LEDGER.entries).sort(compareSemver).pop()
    const staticHref = `${DOWNLOAD}/v${newest}/Tachles-Setup-${newest}.exe`
    for (const payload of [null, {}, 'nope', [null, 7, { tag_name: 'nightly', assets: [] }]]) {
      const doc = await renderWith(ok(payload))
      expect(doc.getElementById('download-btn').href).toBe(staticHref)
    }
  })
})

/** Minimal SemVer ordering, only for picking the newest ledger entry. */
function compareSemver(a, b) {
  const parse = v => {
    const [core, pre] = v.split('-')
    return { nums: core.split('.').map(Number), pre: pre ? pre.split('.') : [] }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i]
  if (!pa.pre.length && !pb.pre.length) return 0
  if (!pa.pre.length) return 1
  if (!pb.pre.length) return -1
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y)
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

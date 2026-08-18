// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

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

  it('corrects the footnote once the button hands over a file directly', async () => {
    const before = new JSDOM(HTML).window.document.getElementById('download-note').textContent
    expect(before).toContain('נפתחת בעמוד הגרסאות')
    const doc = await renderWith(ok([release('v0.4.0-alpha.10')]))
    expect(doc.getElementById('download-note').textContent).toContain('מתחילה מיד')
  })

  it('leaves the working static links alone when GitHub cannot be reached', async () => {
    // Rate limit, offline, blocked — the page must degrade to something that
    // still works and still describes itself accurately, never to a dead button.
    for (const failing of [async () => ({ ok: false, status: 403, json: async () => ({}) }), async () => { throw new Error('offline') }]) {
      const doc = await renderWith(failing)
      const btn = doc.getElementById('download-btn')
      expect(btn.href).toBe('https://github.com/NehoraiHadad/hermes-business/releases')
      expect(doc.getElementById('download-version').hidden).toBe(true)
      expect(doc.getElementById('download-note').textContent).toContain('נפתחת בעמוד הגרסאות')
    }
  })

  it('ignores a malformed payload rather than writing junk into the button', async () => {
    for (const payload of [null, {}, 'nope', [null, 7, { tag_name: 'nightly', assets: [] }]]) {
      const doc = await renderWith(ok(payload))
      expect(doc.getElementById('download-btn').href).toBe('https://github.com/NehoraiHadad/hermes-business/releases')
    }
  })
})

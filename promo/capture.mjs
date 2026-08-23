/**
 * Renders the real-UI shots frame by frame.
 *
 * The first version of this recorded in real time with Playwright's video
 * recorder, and the result was choppy for two compounding reasons: the recorder
 * delivers a flat 25fps, which the 30fps assembly then resampled by duplicating
 * every fifth frame unevenly, and the content itself changed faster than 25fps
 * could sample -- typing at ~30 characters a second, and a scroll stepping 2px
 * every 24ms of wall-clock time.
 *
 * So nothing here runs on wall-clock time. Each shot is a list of steps that
 * emit an exact number of screenshots, one per output frame, and every animated
 * thing -- caption fades, the pasted-document scroll, the pointer -- is advanced
 * by the renderer between frames rather than by CSS or setInterval. The output
 * is genuinely constant-frame-rate: 30 real, distinct frames per second, no
 * duplicates, no resample. It is slower to produce (a screenshot per frame) and
 * that is the whole trade.
 *
 * Everything on screen is still the real built bundle in a real browser. The
 * only synthetic element is the pointer dot, because Playwright screenshots
 * never contain the actual mouse cursor and a click with nothing on screen to
 * motivate it reads as a glitch.
 */
import { chromium } from '@playwright/test'
import { readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = join(HERE, 'shots')
const WORK = join(HERE, '.frames')
const URL_ = 'http://localhost:4890/promo/stage.html'
const SIZE = { width: 1920, height: 1080 }
const FPS = 30

/** A real Microsoft Word export, straight from the repo's own sample. */
const WORD = readFileSync(join(REPO, 'demo/samples/quarterly-review.html'), 'utf8')
  .replace(/^[\s\S]*?<body[^>]*>/i, '')
  .replace(/<\/body>[\s\S]*$/i, '')

const secs = (n) => Math.max(1, Math.round(n * FPS))
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/** One shot's frame writer. Frame numbers are the shot's clock. */
class Reel {
  constructor(page, name) {
    this.page = page
    this.dir = join(WORK, name)
    this.n = 0
    this.debt = 0
    rmSync(this.dir, { recursive: true, force: true })
    mkdirSync(this.dir, { recursive: true })
  }

  /** Emit one frame. `caret: 'hide'` keeps a blinking caret out of the render:
      it blinks on wall-clock time, which frame capture samples unevenly. */
  async frame() {
    await this.page.screenshot({
      path: join(this.dir, `${String(this.n++).padStart(5, '0')}.png`),
      caret: 'hide',
      animations: 'disabled',
    })
  }

  /** Hold the current state for `seconds`. */
  async hold(seconds) {
    for (let i = 0; i < secs(seconds); i++) await this.frame()
  }

  /** Advance something over `seconds`, calling `step(progress)` per frame. */
  async over(seconds, step) {
    const total = secs(seconds)
    for (let i = 1; i <= total; i++) {
      await step(i / total)
      await this.frame()
    }
  }

  /**
   * Type at a rate in characters per second, keeping fractional frames-per-char
   * as a running debt so the average rate is exact rather than rounded per key.
   */
  async type(text, cps = 11) {
    const perChar = FPS / cps
    for (const ch of text) {
      await this.page.keyboard.type(ch)
      this.debt += perChar
      while (this.debt >= 1) {
        await this.frame()
        this.debt -= 1
      }
    }
  }

  async fadeCaption(html, seconds = 0.45) {
    await this.page.evaluate((h) => window.stage.caption(h), html)
    await this.over(seconds, (t) => this.page.evaluate((v) => window.stage.captionAt(v), t))
  }

  async unfadeCaption(seconds = 0.35) {
    await this.over(seconds, (t) => this.page.evaluate((v) => window.stage.captionAt(1 - v), t))
  }

  /** Glide the pointer to an element's centre, then hold a beat on arrival. */
  async pointTo(locator, seconds = 0.55) {
    const box = await locator.boundingBox()
    if (!box) throw new Error('cannot point at an element with no box')
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const from = this.pointer ?? { x: to.x, y: to.y + 260 }
    await this.over(seconds, (t) => {
      const e = ease(t)
      return this.page.evaluate(
        ([x, y]) => window.stage.pointer(x, y),
        [from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e],
      )
    })
    this.pointer = to
    return to
  }

  /** Point at something, then click it, with a beat either side. */
  async pointAndClick(locator, { hover = false } = {}) {
    const at = await this.pointTo(locator)
    await this.hold(0.2)
    if (hover) await locator.hover()
    else await locator.click()
    await this.hold(0.35)
    return at
  }

  async hidePointer() {
    await this.page.evaluate(() => window.stage.pointer(null))
  }

  /** Encode the frames into a CFR clip. No resampling happens anywhere. */
  encode(name) {
    const out = join(SHOTS, `${name}.mp4`)
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-framerate', String(FPS), '-i', join(this.dir, '%05d.png'),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      out,
    ], { stdio: 'inherit' })
    return { out, frames: this.n, seconds: this.n / FPS }
  }
}

const browser = await chromium.launch()

async function shot(name, body) {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
  await page.goto(URL_)
  await page.waitForFunction(() => window.stage && window.stage.ready(), null, { timeout: 20000 })
  const reel = new Reel(page, name)
  await body(page, reel)
  const { frames, seconds } = reel.encode(name)
  await context.close()
  console.log(`${name}  ${frames} frames  ${seconds.toFixed(2)}s  ${problems.length ? 'PROBLEMS: ' + problems.join(' | ') : 'clean'}`)
}

const editor = (page) => page.getByRole('textbox', { name: 'Post body' })

async function pasteHtml(page, html) {
  const ok = await page.evaluate((payload) => {
    const region = document.querySelector('.ProseMirror')
    if (!region) return false
    region.focus()
    const data = new DataTransfer()
    data.setData('text/html', payload)
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    if (!event.clipboardData) return false
    region.dispatchEvent(event)
    return true
  }, html)
  if (!ok) throw new Error('synthetic paste was refused -- the shot would be a lie')
}

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true })
rmSync(SHOTS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
rmSync(WORK, { recursive: true, force: true })

/* ---- 01. title card -------------------------------------------------- */
await shot('01-title', async (page, reel) => {
  await page.evaluate(() => window.stage.card(`
    <div>
      <img src="/demo/assets/openleaf-logo-dark.png" alt="OpenLeaf">
      <h1>A rich text editor<br>that is <em>actually free</em>.</h1>
      <p>HTML in, HTML out. No paid tier, no license key, no telemetry.</p>
    </div>`))
  await reel.hold(4)
})

/* ---- 02. it is just an editor ---------------------------------------- */
await shot('02-editing', async (page, reel) => {
  await reel.hold(0.5)
  await reel.fadeCaption('Drops into the CMS form you already have')
  await editor(page).click()
  await page.keyboard.press('Meta+a')
  await reel.hold(0.4)
  await reel.type('Northwind ships this quarter', 12)
  await reel.hold(0.7)
  /* By value, not by label: the select disables the option matching the block
     the caret is already in, and Playwright refuses to pick a disabled one. */
  const style = page.getByRole('combobox', { name: 'Paragraph style' })
  await reel.pointTo(style)
  await reel.hold(0.25)
  await style.selectOption('2')
  await reel.hold(1)
  await editor(page).click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.press('Enter')
  await reel.hold(0.4)
  await reel.type('Revenue is up, churn is down, and the ', 13)
  const bold = page.getByRole('button', { name: 'Bold' })
  await reel.pointAndClick(bold)
  await reel.type('editor costs nothing', 12)
  await reel.pointAndClick(bold)
  await reel.type('.', 6)
  await reel.hidePointer()
  await reel.hold(1.6)
})

/* ---- 03. the hero: Word paste ---------------------------------------- */
await shot('03-word-paste', async (page, reel) => {
  await page.evaluate(() => {
    window.stage.split(true)
    window.stage.title('CMS — paste from Word')
    document.querySelector('openleaf-editor').value = '<p></p>'
  })
  await reel.hold(0.5)
  await reel.fadeCaption('Paste a <em>Word</em> document. Get clean HTML.')
  await editor(page).click()
  await reel.hold(1.1)
  await pasteHtml(page, WORD)
  await reel.hold(2.4)
  await reel.unfadeCaption()
  await reel.fadeCaption('No <em>mso-</em> junk. No conditional comments. Real lists.')
  await reel.hold(0.6)
  /* Ride down the pasted document a frame at a time, so the whole result is on
     screen at some point and the motion is even at 30fps. */
  const range = await page.evaluate(() => {
    const box = document.querySelector('.ol-content')
    box.scrollTop = 0
    return box.scrollHeight - box.clientHeight
  })
  await reel.over(4.2, (t) =>
    page.evaluate((y) => { document.querySelector('.ol-content').scrollTop = y }, ease(t) * range))
  await reel.hold(1.4)
})

/* ---- 04. the bound textarea ------------------------------------------ */
await shot('04-textarea', async (page, reel) => {
  await page.evaluate(() => { window.stage.split(true); window.stage.title('CMS — edit post') })
  await reel.hold(0.5)
  await reel.fadeCaption('Your form still submits a <em>&lt;textarea&gt;</em>')
  await editor(page).click()
  await page.keyboard.press('Meta+a')
  await reel.hold(0.4)
  await reel.type('Nothing to migrate on the server.', 12)
  await reel.hold(1.1)
  await reel.pointAndClick(page.getByRole('button', { name: 'Bulleted list' }))
  await page.keyboard.press('Enter')
  await reel.type('Existing POST handler', 12)
  await page.keyboard.press('Enter')
  await reel.hold(0.3)
  await reel.type('Existing sanitiser', 12)
  await reel.hidePointer()
  await reel.hold(1.8)
})

/* ---- 05. tables ------------------------------------------------------ */
await shot('05-tables', async (page, reel) => {
  await reel.hold(0.5)
  await reel.fadeCaption('Tables come from a <em>19 KB</em> plugin you opt into')
  await editor(page).click()
  await page.keyboard.press('Meta+a')
  await reel.hold(0.3)
  await reel.type('Q3 by region', 12)
  await page.keyboard.press('Enter')
  await reel.hold(0.4)
  await reel.pointAndClick(page.getByRole('button', { name: 'Insert table' }))
  await reel.hold(0.5)
  // Drag across the size grid so the live "3 x 2" readout is part of the shot.
  for (const [r, c] of [[1, 2], [2, 3], [3, 2]]) {
    await reel.pointAndClick(page.getByRole('gridcell', { name: `${r} by ${c} table` }), { hover: true })
  }
  await page.getByRole('gridcell', { name: '3 by 2 table' }).click()
  await reel.hidePointer()
  await reel.hold(0.8)
  /* Click each cell rather than tabbing: Tab is deliberately an escape from the
     editor here, not cell navigation, so tabbing would type into the toolbar. */
  const cells = page.locator('.ol-content table th, .ol-content table td')
  const text = ['Region', 'Growth', 'North', '+12%', 'South', '+4%']
  for (let i = 0; i < text.length; i++) {
    await cells.nth(i).click()
    await reel.hold(0.15)
    await reel.type(text[i], 13)
    await reel.hold(0.2)
  }
  await reel.hold(1.8)
})

/* ---- 06. the terms card ---------------------------------------------- */
await shot('06-terms', async (page, reel) => {
  await page.evaluate(() => window.stage.card(`
    <div>
      <h1>Free means <em>free</em>.</h1>
      <ul>
        <li>Apache-2.0</li><li>No paid tier</li><li>No license key</li>
        <li>No telemetry</li><li>No cloud dependency</li>
      </ul>
      <p>Framework-agnostic. Built on ProseMirror.<br>121 KB gzipped, and you can read all of it.</p>
    </div>`))
  await reel.hold(4.8)
})

/* ---- 07. outro ------------------------------------------------------- */
await shot('07-outro', async (page, reel) => {
  await page.evaluate(() => window.stage.card(`
    <div>
      <img src="/demo/assets/openleaf-logo-dark.png" alt="OpenLeaf">
      <code>npm i @openleaf-editor/element</code>
      <p style="margin-top:34px">github.com/PeytonNowlin/openleaf</p>
    </div>`))
  await reel.hold(5.2)
})

rmSync(WORK, { recursive: true, force: true })
await browser.close()

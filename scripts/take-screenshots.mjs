import puppeteer from 'puppeteer'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'screenshots')
const BASE = 'http://localhost:5173'
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2 }

const wait = ms => new Promise(r => setTimeout(r, ms))

async function shot(page, name) {
  await wait(380)
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false })
  console.log(`  ✓ ${name}.png`)
}

async function clickText(page, text) {
  await page.evaluate(t => {
    const el = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes(t))
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }, text)
  await wait(300)
}

async function closeOverlay(page) {
  // Click the backdrop at a point above the bottom sheet (top area = backdrop only)
  await page.evaluate(() => {
    const el = document.elementFromPoint(195, 220)
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await wait(350)
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await wait(700)

  // ── 1. Posts → New (channel header visible) ──────────────────────────────
  await clickText(page, 'Posts')
  await wait(200)
  await shot(page, '01-posts-new')

  // ── 2. Channel switcher open ──────────────────────────────────────────────
  await page.evaluate(() => {
    // The channel header button contains "@username" text (may start with avatar letter)
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('@'))
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await wait(500)
  await shot(page, '02-channel-switcher')
  await closeOverlay(page)

  // ── 3. Post Detail ────────────────────────────────────────────────────────
  // Ensure we're on Posts → New
  await clickText(page, 'Posts')
  await wait(200)
  await clickText(page, 'New')
  await wait(200)
  // Click the first post card (motion.div with glass-card inside)
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.glass-card')
    if (cards[0]) cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await wait(500)
  await shot(page, '03-post-detail')

  // ── 4. Create ─────────────────────────────────────────────────────────────
  await clickText(page, 'Create')
  await wait(200)
  await shot(page, '04-create')

  // ── 5. Profile (Current Plan card) ───────────────────────────────────────
  await clickText(page, 'Profile')
  await wait(300)
  await shot(page, '05-profile')

  // ── 6. Plans screen ───────────────────────────────────────────────────────
  await clickText(page, 'Manage plan')
  await wait(400)
  await shot(page, '06-plans')

  // Back to Profile
  await page.evaluate(() => {
    const back = document.querySelector('button[class*="rounded-full"]')
    if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await wait(350)

  // ── 7. Brand Kit overview ─────────────────────────────────────────────────
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Brand Kit'))
    if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await wait(450)
  await shot(page, '07-brand-kit-overview')

  await browser.close()
  console.log('\n✓ All 7 screenshots saved to screenshots/')
}

main().catch(e => { console.error(e); process.exit(1) })

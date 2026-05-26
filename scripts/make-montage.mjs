import puppeteer from 'puppeteer'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SS = join(__dirname, '..', 'screenshots')
const OUT = join(SS, 'montage.png')

// 5 key screens for montage
const screens = [
  { file: '01-posts-new.png',    label: 'Posts' },
  { file: '03-post-detail.png',  label: 'Post Detail' },
  { file: '04-create.png',       label: 'Create' },
  { file: '05-profile.png',      label: 'Profile' },
  { file: '06-plans.png',        label: 'Plans' },
]

function toDataUrl(file) {
  const buf = readFileSync(join(SS, file))
  return 'data:image/png;base64,' + buf.toString('base64')
}

const PHONE_W = 390
const PHONE_H = 844
const SCALE   = 0.48
const GAP     = 20
const LABEL_H = 28
const PAD     = 32
const BG      = '#0A0A0C'
const ACCENT  = '#FF6A00'

const dw = Math.round(PHONE_W * SCALE)
const dh = Math.round(PHONE_H * SCALE)
const totalW = PAD * 2 + screens.length * dw + (screens.length - 1) * GAP
const totalH = PAD * 2 + dh + LABEL_H + 16

const items = screens.map(s => `
  <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
    <div style="
      width:${dw}px;height:${dh}px;border-radius:28px;overflow:hidden;
      box-shadow:0 8px 40px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.08);
    ">
      <img src="${toDataUrl(s.file)}" width="${dw}" height="${dh}" style="display:block;" />
    </div>
    <span style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.45);letter-spacing:0.04em;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;">
      ${s.label}
    </span>
  </div>
`).join('')

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}</style></head>
<body style="background:${BG};width:${totalW}px;height:${totalH}px;display:flex;align-items:flex-start;padding:${PAD}px ${PAD}px;gap:${GAP}px;">
  ${items}
  <div style="position:absolute;bottom:${PAD - 10}px;left:0;right:0;text-align:center;">
    <span style="font-size:11px;font-weight:500;color:${ACCENT};opacity:0.55;letter-spacing:0.08em;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;">
      CONTENT FACTORY — TELEGRAM MINI APP
    </span>
  </div>
</body>
</html>`

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: totalW, height: totalH, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 200))
await page.screenshot({ path: OUT, fullPage: false })
await browser.close()

console.log(`✓ montage.png  (${totalW}×${totalH} @2x)`)
console.log(`  saved to: ${OUT}`)

import puppeteer from 'puppeteer'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'

const HOST = '127.0.0.1'
const PORT = 4173
const BASE_URL = `http://${HOST}:${PORT}`
const viteBin = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForServer(processHandle) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`Vite preview exited with code ${processHandle.exitCode}`)
    try {
      const response = await fetch(BASE_URL)
      if (response.ok) return
    } catch { /* preview is still starting */ }
    await sleep(250)
  }
  throw new Error('Timed out waiting for Vite preview')
}

async function bodyIncludes(page, expected) {
  await page.waitForFunction(text => document.body.innerText.toLocaleLowerCase('ru').includes(text.toLocaleLowerCase('ru')), { timeout: 5_000 }, expected)
}

async function clickButton(page, label) {
  const clicked = await page.evaluate(text => {
    const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === text)
    button?.click()
    return Boolean(button)
  }, label)
  if (!clicked) throw new Error(`Button not found: ${label}`)
  await sleep(350)
}

const preview = spawn(process.execPath, [viteBin, 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
let previewOutput = ''
preview.stdout.on('data', chunk => { previewOutput += chunk })
preview.stderr.on('data', chunk => { previewOutput += chunk })

let browser
try {
  await waitForServer(preview)
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('cf_onboarded', '1')
    localStorage.setItem('content-factory-language', 'ru')
  })

  const runtimeErrors = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  page.on('requestfailed', request => {
    if (request.url().startsWith(BASE_URL)) runtimeErrors.push(`Request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`)
  })

  await page.goto(`${BASE_URL}/?mock=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(() => document.body.innerText.includes('Посты'), { timeout: 15_000 })
  for (const label of ['Посты', 'Создать', 'AI', 'Стили', 'Профиль']) await bodyIncludes(page, label)
  for (const label of ['Новые', 'Отложка', 'Архив']) await bodyIncludes(page, label)

  await clickButton(page, 'Создать')
  await bodyIncludes(page, 'Создать пост')

  await clickButton(page, 'Профиль')
  await bodyIncludes(page, 'Текущий план')
  await bodyIncludes(page, 'Каналы')

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (horizontalOverflow) throw new Error('Mobile layout has horizontal overflow')
  if (runtimeErrors.length) throw new Error(['Browser runtime errors:', ...runtimeErrors].join('\n'))

  const unauthenticatedPage = await browser.newPage()
  await unauthenticatedPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await unauthenticatedPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await bodyIncludes(unauthenticatedPage, 'Откройте Publium через Telegram')
  const leakedMockData = await unauthenticatedPage.evaluate(() => document.body.innerText.includes('Посты'))
  if (leakedMockData) throw new Error('Production launch without Telegram initData exposed mock data')
  await unauthenticatedPage.close()

  const launchFallbackPage = await browser.newPage()
  await launchFallbackPage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await launchFallbackPage.evaluateOnNewDocument(() => {
    localStorage.setItem('cf_onboarded', '1')
    localStorage.setItem('content-factory-language', 'ru')
  })
  await launchFallbackPage.setRequestInterception(true)
  const fallbackInitData = 'query_id=fallback-query&user=%7B%22id%22%3A5473066892%7D&auth_date=1&hash=test'
  let capturedInitData = null
  launchFallbackPage.on('request', request => {
    const url = new URL(request.url())
    if (url.hostname === 'telegram.org' && url.pathname.endsWith('/telegram-web-app.js')) {
      void request.respond({ status: 200, contentType: 'application/javascript', body: '' })
      return
    }
    if (url.pathname === '/api/auth/telegram') {
      capturedInitData = JSON.parse(request.postData() ?? '{}').initData ?? null
      void request.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: { id: 'user-1', name: 'Test', telegramId: '5473066892', username: 'test', activeChannelId: null },
          channels: [],
          brandKits: [],
          subscription: null,
        }),
      })
      return
    }
    if (url.pathname === '/api/posts/list') {
      void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ posts: [] }) })
      return
    }
    void request.continue()
  })
  await launchFallbackPage.goto(
    `${BASE_URL}/#tgWebAppData=${encodeURIComponent(fallbackInitData)}&tgWebAppVersion=9.0`,
    { waitUntil: 'domcontentloaded', timeout: 30_000 },
  )
  const fallbackDeadline = Date.now() + 10_000
  while (capturedInitData === null && Date.now() < fallbackDeadline) await sleep(50)
  if (capturedInitData !== fallbackInitData) throw new Error('Telegram launch tgWebAppData fallback was not used for auth')
  await launchFallbackPage.close()

  console.log('Frontend smoke passed: Posts → Create → Profile (390x844, mock mode)')
  console.log('Frontend auth gate passed: production launch without initData exposes no mock data')
  console.log('Frontend Telegram launch fallback passed: tgWebAppData reaches auth without SDK assistance')
} catch (error) {
  if (previewOutput.trim()) console.error(previewOutput.trim())
  throw error
} finally {
  await browser?.close().catch(() => undefined)
  if (preview.exitCode === null) {
    preview.kill('SIGTERM')
    await Promise.race([once(preview, 'exit'), sleep(3_000)])
    if (preview.exitCode === null) preview.kill('SIGKILL')
  }
}

/**
 * Creates the final handoff zip using zip-stream (already in node_modules via archiver).
 */
import { createWriteStream, createReadStream, existsSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ZipStream = require('zip-stream').default

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT  = join(ROOT, '..', 'content-factory-miniapp-final.zip')

const zip    = new ZipStream({ level: 9 })
const output = createWriteStream(OUT)

let totalBytes = 0
output.on('close', () => {
  const mb = (totalBytes / 1024 / 1024).toFixed(2)
  console.log(`\n✓ Archive: ${OUT}`)
  console.log(`  Size: ${mb} MB`)
})
zip.on('data', chunk => { totalBytes += chunk.length })
zip.pipe(output)

// Helper: add a single file
function addFile(diskPath, zipName) {
  return new Promise((res, rej) => {
    zip.entry(createReadStream(diskPath), { name: zipName }, err => {
      if (err) rej(err); else res()
    })
  })
}

// Helper: recursively add a directory
async function addDir(diskDir, zipBase) {
  const entries = readdirSync(diskDir, { withFileTypes: true })
  for (const e of entries) {
    const full = join(diskDir, e.name)
    const zp   = zipBase + '/' + e.name
    if (e.isDirectory()) {
      await addDir(full, zp)
    } else {
      await addFile(full, zp)
      process.stdout.write('.')
    }
  }
}

// ── Build the archive ─────────────────────────────────────────────────────
console.log('Building archive...')

// Directories
await addDir(join(ROOT, 'src'),         'src')
await addDir(join(ROOT, 'scripts'),     'scripts')
await addDir(join(ROOT, 'screenshots'), 'screenshots')

// Root config files
const rootFiles = [
  'package.json', 'package-lock.json', 'index.html',
  'vite.config.ts', 'tailwind.config.ts',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
  'postcss.config.js', 'postcss.config.cjs', 'README.md',
]
for (const f of rootFiles) {
  const p = join(ROOT, f)
  if (existsSync(p)) { await addFile(p, f); process.stdout.write('.') }
}

zip.finalize()
await new Promise(res => output.on('close', res))

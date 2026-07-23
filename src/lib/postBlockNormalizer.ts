import type { ListItem, PostBlock, Run } from '@/types'

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const run = (value: unknown): Run | null => {
  const r = record(value)
  if (!r || typeof r.t !== 'string') return null
  return {
    t: r.t,
    ...(r.b === true ? { b: true } : {}), ...(r.i === true ? { i: true } : {}),
    ...(r.u === true ? { u: true } : {}), ...(r.s === true ? { s: true } : {}),
    ...(r.code === true ? { code: true } : {}), ...(r.spoiler === true ? { spoiler: true } : {}),
    ...(r.mark === true ? { mark: true } : {}), ...(typeof r.link === 'string' ? { link: r.link } : {}),
  }
}

const runs = (value: unknown): Run[] =>
  Array.isArray(value) ? value.map(run).filter((r): r is Run => r !== null) : []

const listItem = (value: unknown): ListItem | null => {
  if (Array.isArray(value)) {
    const normalized = runs(value)
    return normalized.length ? { runs: normalized } : null
  }
  if (typeof value === 'string') return { runs: [{ t: value }] }
  const item = record(value)
  if (!item) return null
  const normalized = runs(item.runs)
  if (!normalized.length && typeof item.text === 'string') normalized.push({ t: item.text })
  if (!normalized.length) return null
  const sub = Array.isArray(item.sub) ? item.sub.map(runs).filter(v => v.length > 0) : []
  return sub.length ? { runs: normalized, sub } : { runs: normalized }
}

const matrix4 = (value: unknown): string[][] | undefined => {
  if (!Array.isArray(value) || value.length !== 4) return undefined
  const rows = value.map(row => Array.isArray(row) ? row.filter((v): v is string => typeof v === 'string') : [])
  return rows.every(row => row.length === 4) ? rows : undefined
}

const panorama = (value: unknown): Extract<PostBlock, { type: 'gallery' }>['panorama'] => {
  const p = record(value)
  if (!p || typeof p.sourceUrl !== 'string' || !p.sourceUrl.trim()) return undefined
  if (p.method !== 'ai' && p.method !== 'upload') return undefined
  if (p.orientation !== 'horizontal' && p.orientation !== 'vertical' && p.orientation !== 'grid4') return undefined
  const count = p.orientation === 'grid4' ? 16 : Math.min(8, Math.max(2, typeof p.count === 'number' ? Math.round(p.count) : 3))
  return { sourceUrl: p.sourceUrl, method: p.method, orientation: p.orientation, count }
}
const block = (value: unknown): PostBlock | null => {
  const b = record(value)
  if (!b || typeof b.type !== 'string') return null
  switch (b.type) {
    case 'heading': return typeof b.text === 'string' ? { type: 'heading', text: b.text, ...(typeof b.link === 'string' ? { link: b.link } : {}) } : null
    case 'paragraph': return { type: 'paragraph', runs: runs(b.runs) }
    case 'list': return { type: 'list', ordered: b.ordered === true, items: Array.isArray(b.items) ? b.items.map(listItem).filter((v): v is ListItem => v !== null) : [] }
    case 'quote': return { type: 'quote', runs: runs(b.runs), expandable: b.expandable === true }
    case 'table': return { type: 'table', headers: Array.isArray(b.headers) ? b.headers.map(v => typeof v === 'string' ? v : '') : [], rows: Array.isArray(b.rows) ? b.rows.filter(Array.isArray).map(row => row.map(v => typeof v === 'string' ? v : '')) : [] }
    case 'image': return typeof b.url === 'string' ? { type: 'image', url: b.url, ...(typeof b.prompt === 'string' ? { prompt: b.prompt } : {}) } : null
    case 'video': return typeof b.url === 'string' ? { type: 'video', url: b.url, ...(typeof b.poster === 'string' ? { poster: b.poster } : {}) } : null
    case 'document': return typeof b.url === 'string' && typeof b.name === 'string' ? { type: 'document', url: b.url, name: b.name, ...(typeof b.mime === 'string' ? { mime: b.mime } : {}), ...(typeof b.size === 'number' ? { size: b.size } : {}) } : null
    case 'gallery': { const grid = matrix4(b.matrix4); const pano = panorama(b.panorama); return { type: 'gallery', layout: b.layout === 'collage' || b.layout === 'stack' ? b.layout : 'slideshow', urls: grid?.flat() ?? (Array.isArray(b.urls) ? b.urls.filter((v): v is string => typeof v === 'string') : []), ...(grid ? { matrix4: grid } : {}), ...(pano ? { panorama: pano } : {}) } }
    case 'linkbox': return typeof b.text === 'string' && typeof b.url === 'string' ? { type: 'linkbox', text: b.text, url: b.url } : null
    case 'checklist': return { type: 'checklist', items: Array.isArray(b.items) ? b.items.flatMap(value => { const item = record(value); return item && typeof item.text === 'string' ? [{ text: item.text, checked: item.checked === true }] : [] }) : [] }
    case 'details': return typeof b.summary === 'string' && typeof b.body === 'string' ? { type: 'details', summary: b.summary, body: b.body } : null
    case 'code': return typeof b.text === 'string' ? { type: 'code', text: b.text, ...(typeof b.language === 'string' ? { language: b.language } : {}) } : null
    case 'divider': return { type: 'divider' }
    default: return null
  }
}

function collapseLegacyMatrix4(blocks: PostBlock[]): PostBlock[] {
  const output: PostBlock[] = []
  for (let i = 0; i < blocks.length;) {
    const candidate = blocks.slice(i, i + 4)
    const galleries = candidate.filter((item): item is Extract<PostBlock, { type: 'gallery' }> => item.type === 'gallery')
    let prefix: string | null = null
    const isLegacyMatrix = candidate.length === 4 && galleries.length === 4 && galleries.every((gallery, row) =>
      !gallery.matrix4 && gallery.layout === 'slideshow' && gallery.urls.length === 4 && gallery.urls.every((url, column) => {
        const match = url.match(/^(.*)-r([0-3])-c([0-3])\.png(?:\?.*)?$/)
        if (!match || Number(match[2]) !== row || Number(match[3]) !== column) return false
        if (prefix === null) prefix = match[1] ?? null
        return prefix !== null && match[1] === prefix
      }),
    )
    if (isLegacyMatrix) {
      const rows = galleries.map(gallery => gallery.urls)
      output.push({ type: 'gallery', layout: 'slideshow', urls: rows.flat(), matrix4: rows })
      i += 4
    } else {
      output.push(blocks[i]!)
      i += 1
    }
  }
  return output
}

export function normalizePostBlocks(value: unknown): PostBlock[] | null {
  if (!Array.isArray(value)) return null
  return collapseLegacyMatrix4(value.map(block).filter((b): b is PostBlock => b !== null))
}
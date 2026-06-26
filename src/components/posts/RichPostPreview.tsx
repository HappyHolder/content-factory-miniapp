import type { PostBlock, Run } from '@/types'

/**
 * Faithful, read-only preview of a formatted post — renders PostBlock[] to look
 * like the real Telegram channel message (channel header, cover, headings,
 * lists, tables, expandable quotes, inline images, swipeable slideshow / grid).
 */

// ─── Inline runs ↔ plain text (for the editor) ──────────────────────────────────

// Inline markers (one style per run; non-nested — the editor wraps a selection
// in a single marker): **bold** __italic__ ~~strike~~ `code` ==mark== ||spoiler||
export function runsToText(runs: Run[]): string {
  return runs.map(r => {
    let t = r.t
    if (r.code)    t = '`' + t + '`'
    if (r.b)       t = `**${t}**`
    if (r.i)       t = `__${t}__`
    if (r.s)       t = `~~${t}~~`
    if (r.mark)    t = `==${t}==`
    if (r.spoiler) t = `||${t}||`
    if (r.link)    t = `[${t}](${r.link})`
    return t
  }).join('')
}

export function textToRuns(text: string): Run[] {
  const runs: Run[] = []
  const re = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|==[^=]+==|\|\|[^|]+\|\|)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ t: text.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('[')) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
      if (lm) runs.push({ t: lm[1]!, link: lm[2]! })
    } else {
      const inner = tok.slice(2, -2), inner1 = tok.slice(1, -1)
      if      (tok.startsWith('**')) runs.push({ t: inner, b: true })
      else if (tok.startsWith('__')) runs.push({ t: inner, i: true })
      else if (tok.startsWith('~~')) runs.push({ t: inner, s: true })
      else if (tok.startsWith('==')) runs.push({ t: inner, mark: true })
      else if (tok.startsWith('||')) runs.push({ t: inner, spoiler: true })
      else                           runs.push({ t: inner1, code: true })
    }
    last = m.index + tok.length
  }
  if (last < text.length) runs.push({ t: text.slice(last) })
  return runs.length ? runs : [{ t: text }]
}

// ─── Inline rendering ───────────────────────────────────────────────────────────

function RunSpan({ r }: { r: Run }) {
  let node: React.ReactNode = r.t
  if (r.code) node = <code className="font-mono text-[12px] bg-white/[0.08] rounded px-1 py-px">{node}</code>
  if (r.b) node = <b className="font-semibold text-white">{node}</b>
  if (r.i) node = <i>{node}</i>
  if (r.u) node = <u>{node}</u>
  if (r.s) node = <s>{node}</s>
  if (r.mark) node = <mark className="bg-[#FF6A00]/30 text-white rounded px-1">{node}</mark>
  if (r.spoiler) node = <span className="bg-white/20 text-white/30 rounded px-1 select-none">{node}</span>
  if (r.link) node = <span className="text-[#5AA9FF]">{node}</span>
  return <>{node}</>
}

function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => <RunSpan key={i} r={r} />)}</>
}

// ─── Block rendering ────────────────────────────────────────────────────────────

function Block({ b }: { b: PostBlock }) {
  switch (b.type) {
    case 'heading':
      return <p className="text-[15.5px] font-bold text-white leading-snug">{b.text}</p>
    case 'paragraph':
      return <p className="text-[14px] text-[#E4E4E7] leading-[1.55]"><Runs runs={b.runs} /></p>
    case 'list':
      return b.ordered ? (
        <ol className="list-decimal pl-5 space-y-1 text-[14px] text-[#E4E4E7] marker:text-[#FF6A00]">
          {b.items.map((it, i) => <li key={i}><Runs runs={it} /></li>)}
        </ol>
      ) : (
        <ul className="list-disc pl-5 space-y-1 text-[14px] text-[#E4E4E7] marker:text-[#FF6A00]">
          {b.items.map((it, i) => <li key={i}><Runs runs={it} /></li>)}
        </ul>
      )
    case 'quote':
      return (
        <blockquote className="border-l-[3px] border-[#FF6A00] pl-3 py-1 bg-white/[0.03] rounded-r-[8px] text-[13.5px] text-[#C8C8CE]">
          <Runs runs={b.runs} />
          {b.expandable && <span className="block mt-0.5 text-[11px] text-[#FF6A00]">Показать ещё ▾</span>}
        </blockquote>
      )
    case 'table':
      return (
        <div className="overflow-x-auto no-scrollbar rounded-[10px] border border-white/10">
          <table className="w-full text-[12.5px] text-[#E4E4E7] border-collapse">
            {b.headers.length > 0 && (
              <thead>
                <tr>{b.headers.map((h, i) => (
                  <th key={i} className="text-left font-semibold text-white px-2.5 py-1.5 border-b border-white/10 bg-white/[0.04] whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
            )}
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri}>{row.map((c, ci) => (
                  <td key={ci} className="px-2.5 py-1.5 border-b border-white/[0.06] align-top">{c}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'image':
      return <img src={b.url} alt="" className="w-full rounded-[12px] object-cover bg-black" />
    case 'video':
      return <video src={b.url} poster={b.poster} controls playsInline className="w-full rounded-[12px] bg-black" />
    case 'gallery':
      return b.layout === 'collage' ? (
        <div className="grid grid-cols-2 gap-1">
          {b.urls.map((u, i) => <img key={i} src={u} alt="" className="w-full rounded-[8px] object-cover aspect-square bg-black" />)}
        </div>
      ) : (
        <div className="-mx-1">
          <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory px-1 pb-1">
            {b.urls.map((u, i) => (
              <img key={i} src={u} alt="" className="snap-center shrink-0 w-[80%] rounded-[12px] object-cover bg-black" />
            ))}
          </div>
          <p className="text-center text-[10px] text-[#55555D] mt-0.5">← листать · {b.urls.length} фото</p>
        </div>
      )
    case 'divider':
      return <div className="h-px bg-white/10 my-1.5" />
    default:
      return null
  }
}

interface RichPostPreviewProps {
  blocks:       PostBlock[]
  channelName?: string
  channelHandle?: string
  avatarUrl?:   string | null
}

export function RichPostPreview({ blocks, channelName, channelHandle, avatarUrl }: RichPostPreviewProps) {
  if (!blocks || blocks.length === 0) return null
  const initial = (channelName || channelHandle || '?').replace(/^@/, '').charAt(0).toUpperCase()
  return (
    <div className="rounded-[16px] bg-[#0E0E10] border border-white/[0.08] overflow-hidden">
      {/* Telegram-like channel header */}
      {(channelName || channelHandle) && (
        <div className="flex items-center gap-2 px-3.5 pt-3">
          <div className="w-7 h-7 rounded-full bg-[rgba(255,106,0,0.18)] flex items-center justify-center overflow-hidden shrink-0">
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              : <span className="text-[12px] font-bold text-[#FF6A00]">{initial}</span>}
          </div>
          <span className="text-[13px] font-semibold text-[#FF6A00] truncate">
            {channelName || `@${channelHandle?.replace(/^@/, '')}`}
          </span>
        </div>
      )}
      <div className="p-3.5 space-y-2.5">
        {blocks.map((b, i) => <Block key={i} b={b} />)}
      </div>
    </div>
  )
}

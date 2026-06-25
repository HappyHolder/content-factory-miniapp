import type { PostBlock, Run } from '@/types'

/**
 * Read-only WYSIWYG preview of a formatted post — renders PostBlock[] to look
 * close to how Telegram shows the Rich Message (headings, lists, tables,
 * expandable quotes, inline images, swipeable slideshow / collage grid).
 */

// ─── Inline runs ↔ plain text (for the editor) ──────────────────────────────────

/** Serializes Run[] to editable plain text with **bold** / ||spoiler|| markers. */
export function runsToText(runs: Run[]): string {
  return runs.map(r => {
    let t = r.t
    if (r.b) t = `**${t}**`
    if (r.spoiler) t = `||${t}||`
    return t
  }).join('')
}

/** Parses plain text with **bold** / ||spoiler|| markers back into Run[]. */
export function textToRuns(text: string): Run[] {
  const runs: Run[] = []
  const re = /(\*\*[^*]+\*\*|\|\|[^|]+\|\|)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ t: text.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('**')) runs.push({ t: tok.slice(2, -2), b: true })
    else runs.push({ t: tok.slice(2, -2), spoiler: true })
    last = m.index + tok.length
  }
  if (last < text.length) runs.push({ t: text.slice(last) })
  return runs.length ? runs : [{ t: text }]
}

// ─── Inline rendering ───────────────────────────────────────────────────────────

function RunSpan({ r, i }: { r: Run; i: number }) {
  let node: React.ReactNode = r.t
  if (r.code) node = <code className="font-mono text-[12px] bg-white/[0.08] rounded px-1 py-px">{node}</code>
  if (r.b) node = <b className="font-semibold text-white">{node}</b>
  if (r.i) node = <i>{node}</i>
  if (r.u) node = <u>{node}</u>
  if (r.s) node = <s>{node}</s>
  if (r.spoiler) node = <span className="bg-white/15 text-transparent rounded px-1 select-none">{node}</span>
  if (r.link) node = <span className="text-[#5AA9FF]">{node}</span>
  return <span key={i}>{node}</span>
}

function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => <RunSpan key={i} r={r} i={i} />)}</>
}

// ─── Block rendering ────────────────────────────────────────────────────────────

function Block({ b }: { b: PostBlock }) {
  switch (b.type) {
    case 'heading':
      return <p className="text-[15px] font-bold text-white leading-snug">{b.text}</p>
    case 'paragraph':
      return <p className="text-[13.5px] text-[#D4D4D8] leading-relaxed"><Runs runs={b.runs} /></p>
    case 'list':
      return b.ordered ? (
        <ol className="list-decimal pl-5 space-y-1 text-[13.5px] text-[#D4D4D8]">
          {b.items.map((it, i) => <li key={i}><Runs runs={it} /></li>)}
        </ol>
      ) : (
        <ul className="list-disc pl-5 space-y-1 text-[13.5px] text-[#D4D4D8]">
          {b.items.map((it, i) => <li key={i}><Runs runs={it} /></li>)}
        </ul>
      )
    case 'quote':
      return (
        <blockquote className="border-l-2 border-[#FF6A00] pl-3 py-0.5 text-[13.5px] text-[#A8A8B0] italic">
          <Runs runs={b.runs} />
          {b.expandable && <span className="not-italic text-[11px] text-[#FF6A00] ml-1">▾</span>}
        </blockquote>
      )
    case 'table':
      return (
        <div className="overflow-x-auto no-scrollbar rounded-[10px] border border-white/10">
          <table className="w-full text-[12.5px] text-[#D4D4D8] border-collapse">
            {b.headers.length > 0 && (
              <thead>
                <tr>{b.headers.map((h, i) => (
                  <th key={i} className="text-left font-semibold text-white px-2.5 py-1.5 border-b border-white/10 bg-white/[0.03]">{h}</th>
                ))}</tr>
              </thead>
            )}
            <tbody>
              {b.rows.map((row, ri) => (
                <tr key={ri}>{row.map((c, ci) => (
                  <td key={ci} className="px-2.5 py-1.5 border-b border-white/[0.06]">{c}</td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'image':
      return <img src={b.url} alt="" className="w-full rounded-[12px] object-cover bg-black" />
    case 'gallery':
      return b.layout === 'collage' ? (
        <div className="grid grid-cols-2 gap-1.5">
          {b.urls.map((u, i) => <img key={i} src={u} alt="" className="w-full rounded-[10px] object-cover aspect-square bg-black" />)}
        </div>
      ) : (
        <div className="-mx-1 flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1">
          {b.urls.map((u, i) => (
            <img key={i} src={u} alt="" className="snap-center shrink-0 w-[82%] rounded-[12px] object-cover bg-black" />
          ))}
        </div>
      )
    case 'divider':
      return <div className="h-px bg-white/10 my-1" />
    default:
      return null
  }
}

export function RichPostPreview({ blocks }: { blocks: PostBlock[] }) {
  if (!blocks || blocks.length === 0) return null
  return (
    <div className="rounded-[14px] bg-[#0E0E10] border border-white/[0.08] p-3.5 space-y-2.5">
      {blocks.map((b, i) => <Block key={i} b={b} />)}
    </div>
  )
}

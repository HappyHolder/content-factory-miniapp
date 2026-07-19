import React from 'react'

/**
 * Tiny markdown renderer for assistant chat replies. Covers what the model
 * actually emits — bold/italic/strike/inline-code, links, headings, bullet and
 * numbered lists, fenced code blocks. No external deps, no HTML injection
 * (everything renders through React nodes).
 */

function parseInlineMd(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('`')) {
      nodes.push(<code key={key} className="px-1 py-0.5 rounded bg-white/[0.08] text-[12px] text-[#FFB380] font-mono">{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(<strong key={key} className="font-semibold text-white">{parseInlineMd(tok.slice(2, -2), key)}</strong>)
    } else if (tok.startsWith('~~')) {
      nodes.push(<s key={key}>{tok.slice(2, -2)}</s>)
    } else if (tok.startsWith('[')) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok)
      if (link) nodes.push(<a key={key} href={link[2]} target="_blank" rel="noreferrer" className="text-[#FF8A3D] underline underline-offset-2 break-all">{link[1]}</a>)
      else nodes.push(tok)
    } else {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Fenced code block
    if (/^```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) { buf.push(lines[i] ?? ''); i++ }
      i++ // closing fence
      blocks.push(<pre key={key++} className="my-1.5 p-2.5 rounded-lg bg-black/40 border border-white/[0.07] overflow-x-auto text-[11.5px] font-mono text-[#D8D8DC] whitespace-pre">{buf.join('\n')}</pre>)
      continue
    }

    // Bullet list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i] ?? '')) { items.push((lines[i] ?? '').replace(/^\s*[-*•]\s+/, '')); i++ }
      blocks.push(
        <ul key={key++} className="my-1 space-y-1 pl-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-1.5">
              <span className="text-[#FF6A00] leading-[1.55] shrink-0">•</span>
              <span>{parseInlineMd(it, `${key}-${j}`)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // Numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? '')) { items.push(lines[i] ?? ''); i++ }
      blocks.push(
        <ol key={key++} className="my-1 space-y-1 pl-1">
          {items.map((it, j) => {
            const num = /^\s*(\d+)[.)]\s+(.*)$/.exec(it)
            return (
              <li key={j} className="flex gap-1.5">
                <span className="text-[#FF6A00] tabular-nums leading-[1.55] shrink-0">{num?.[1]}.</span>
                <span>{parseInlineMd(num?.[2] ?? it, `${key}-${j}`)}</span>
              </li>
            )
          })}
        </ol>,
      )
      continue
    }

    // Heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(<p key={key++} className="mt-2 mb-1 font-semibold text-white text-[13.5px]">{parseInlineMd(heading[2] ?? '', `h${key}`)}</p>)
      i++
      continue
    }

    // Blank line → small gap
    if (!line.trim()) {
      blocks.push(<div key={key++} className="h-1.5" />)
      i++
      continue
    }

    // Paragraph line
    blocks.push(<p key={key++}>{parseInlineMd(line, `p${key}`)}</p>)
    i++
  }

  return <div className="space-y-0.5 [overflow-wrap:anywhere]">{blocks}</div>
}

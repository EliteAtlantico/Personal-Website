// A story's article body (HTML made from its Markdown) as terminal lines, the
// way a Markdown viewer shows a .md file: # headings, - lists, tables lined up
// in columns, bold and links kept.
import { blank, line, seg, type Line, type Segment, type Style } from './output'

export function bodyLines(html: string): Line[] {
  if (!html.trim()) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.body.children].flatMap((el, i) => [...(i ? [blank()] : []), ...block(el)])
}

function block(el: Element): Line[] {
  switch (el.tagName) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
      return [line(seg(`${'#'.repeat(Number(el.tagName[1]))} `, 'dim'), seg(text(el), 'heading'))]
    case 'UL':
    case 'OL':
      return [...el.children].map((li, i) => {
        const bullet = el.tagName === 'OL' ? `${i + 1}. ` : '- '
        return { segments: [seg(bullet, 'dim'), ...inline(li)], hang: bullet.length }
      })
    case 'TABLE':
      return table(el)
    case 'PRE':
      return (el.textContent ?? '').replace(/\n$/, '').split('\n').map((row) => line(seg(row, 'code')))
    case 'BLOCKQUOTE':
      return [...el.children].flatMap(block).map((l) => ({ ...l, segments: [seg('│ ', 'dim'), ...l.segments], hang: (l.hang ?? 0) + 2 }))
    case 'HR':
      return [line(seg('───', 'dim'))]
    default:
      return [{ segments: inline(el) }]
  }
}

/** Text with its formatting: bold, italics, code and links become styled pieces. */
function inline(node: Node, style?: Style, href?: string): Segment[] {
  const out: Segment[] = []
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/\s+/g, ' ')
      if (text) out.push({ text, ...(style && { style }), ...(href && { href }) })
    } else if (child instanceof Element) {
      const tag = child.tagName
      if (tag === 'BR') out.push({ text: '\n' })
      else if (tag === 'IMG') out.push(seg(`[image: ${child.getAttribute('alt') ?? ''}]`, 'dim'))
      else if (tag === 'UL' || tag === 'OL') continue // nested lists are rare here; the outer item reads fine without them
      else {
        const next: Style | undefined = tag === 'STRONG' || tag === 'B' ? 'strong' : tag === 'EM' || tag === 'I' ? 'em' : tag === 'CODE' ? 'code' : style
        out.push(...inline(child, next, tag === 'A' ? (child.getAttribute('href') ?? undefined) : href))
      }
    }
  }
  // No stray spaces at the start or end of a block.
  if (out[0]) out[0] = { ...out[0], text: out[0].text.trimStart() }
  const last = out.at(-1)
  if (last) out[out.length - 1] = { ...last, text: last.text.trimEnd() }
  return out
}

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** A table with its columns padded to line up (the header in bold, then a rule). */
function table(el: Element): Line[] {
  const rows = [...el.querySelectorAll('tr')].map((tr) => ({ head: tr.querySelector('th') !== null, cells: [...tr.children].map(text) }))
  const widths = rows.reduce<number[]>((w, row) => row.cells.map((cell, i) => Math.max(w[i] ?? 0, cell.length)), [])
  const format = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('   ').trimEnd()
  return rows.flatMap((row) =>
    row.head ? [line(seg(format(row.cells), 'strong')), line(seg(widths.map((w) => '─'.repeat(w)).join('   '), 'dim'))] : [line(format(row.cells))],
  )
}

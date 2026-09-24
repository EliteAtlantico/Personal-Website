// Swarm assembly: on a visit's first page load, the headlines in view dock into
// place letter by letter, like KC-Bots finding their slots. It happens once, at
// the same pace as the bio's snowfall (see pace.ts), then the page is still. Each
// letter's landing spot is measured from the headline's own (copyfitted) lines,
// so it lands exactly where the real text is before the real text is revealed.
import { measuring } from './fonts'
import { intro } from './pace'

export function assembleHeadlines(page: HTMLElement) {
  if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const view = window.innerHeight
  const headlines = [...page.querySelectorAll<HTMLElement>('.tile__headline')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.bottom > 0 && r.top < view
  })
  headlines.forEach((el, i) => assemble(el, intro(i * 70)))
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function assemble(el: HTMLElement, delay: number) {
  const style = getComputedStyle(el)
  const ctx = measuring()
  if (!ctx) return
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const tracking = style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing)
  const lineHeight = parseFloat(style.lineHeight)

  // The headline's lines as shown (copyfitting writes them separated by <br>).
  const lines = ['']
  for (const node of el.childNodes) {
    if (node.nodeName === 'BR') lines.push('')
    else lines[lines.length - 1] += node.textContent ?? ''
  }

  const swarm = document.createElement('span')
  swarm.className = 'swarm'
  swarm.setAttribute('aria-hidden', 'true')
  swarm.style.color = style.color
  // The swarm arrives together from one direction, then each letter finds its slot.
  const from = { x: (Math.random() - 0.5) * 260, y: -50 - Math.random() * 70 }
  const animations: Animation[] = []

  lines.forEach((line, row) => {
    let prefix = ''
    let count = 0
    for (const { segment } of segmenter.segment(line)) {
      const x = ctx.measureText(prefix).width + tracking * count
      prefix += segment
      count++
      if (!segment.trim()) continue
      const letter = document.createElement('span')
      letter.textContent = segment
      swarm.append(letter)
      const y = row * lineHeight
      const jitter = () => (Math.random() - 0.5) * 90
      animations.push(
        letter.animate(
          [
            { transform: `translate(${x + from.x + jitter()}px, ${y + from.y + jitter()}px) rotate(${(Math.random() - 0.5) * 70}deg)`, opacity: 0 },
            { opacity: 1, offset: 0.35 },
            { transform: `translate(${x}px, ${y}px) rotate(0deg)`, opacity: 1 },
          ],
          // Matches the bio's snowfall (see pace.ts).
          { duration: intro(1800 + Math.random() * 1500), delay: delay + intro(Math.random() * 1400), easing: 'cubic-bezier(0.2, 1.3, 0.35, 1)', fill: 'both' },
        ),
      )
    }
  })

  el.classList.add('is-assembling')
  el.append(swarm)
  const done = () => {
    swarm.remove()
    el.classList.remove('is-assembling')
  }
  Promise.all(animations.map((a) => a.finished)).then(done, done)
  // Never leave a headline invisible if frames stop (hidden tab).
  setTimeout(done, delay + intro(1400 + 3300) + 500)
}

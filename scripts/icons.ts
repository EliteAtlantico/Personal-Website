// The site's icons, all from one mark: an orange K, cut from Fraunces (the
// paper's display face) as an outline, so it looks the same on every device
// (an SVG icon can't load a web font), on the terminal's black.
//
//   public/favicon.svg              browser tabs that take SVG
//   public/favicon.ico              16, 32 and 48 px, for the ones that don't (and anything asking for /favicon.ico)
//   public/apple-touch-icon.png     180 px, square: iPhones round the corners themselves
//   public/icon-192.png, -512.png   Android's home screen (manifest.webmanifest)
//   public/icon-maskable-512.png    the same, room to spare for Android's own shapes
//   public/manifest.webmanifest
//
// They're committed, like the fonts: rerun `bun run icons` only if the mark
// or the name changes. It needs Python's fontTools (scripts/fonttools.ts).
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import sharp from 'sharp'
import { python } from './fonttools'

const INK = '#fc7813'
const GROUND = '#00050b'

const config = JSON.parse(readFileSync('content/site.json', 'utf8')) as { author: string; tagline: string }

// --- The K, as an outline in font units (y up), at the weight the nameplate uses ---
const font = createRequire(import.meta.url).resolve('@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2')
const glyph = JSON.parse(
  python(
    [
      '-c',
      `import json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
font = instantiateVariableFont(TTFont(sys.argv[1]), {"wght": float(sys.argv[3])})
glyphs = font.getGlyphSet()
glyph = glyphs[font.getBestCmap()[ord(sys.argv[2])]]
path, bounds = SVGPathPen(glyphs), BoundsPen(glyphs)
glyph.draw(path)
glyph.draw(bounds)
print(json.dumps({"d": path.getCommands(), "bounds": bounds.bounds}))`,
      font,
      'K',
      '700',
    ],
    'draw the K',
  ),
) as { d: string; bounds: [number, number, number, number] }

/** The mark on a `size`-unit square: the K's height a `fill` share of it, centred; `round` rounds the corners. */
function mark({ size = 64, fill = 0.66, round = true } = {}) {
  const [x0, y0, x1, y1] = glyph.bounds
  const scale = (size * fill) / (y1 - y0)
  const tx = size / 2 - (scale * (x0 + x1)) / 2
  const ty = size / 2 + (scale * (y0 + y1)) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}"${round ? ` rx="${(size * 0.1875).toFixed(2)}"` : ''} fill="${GROUND}"/>
  <path transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})" fill="${INK}" d="${glyph.d}"/>
</svg>
`
}

const png = (svg: string, px: number) => sharp(Buffer.from(svg), { density: (72 * px) / 64 }).resize(px, px).png({ compressionLevel: 9 }).toBuffer()

/** An .ico: a small directory, then each size as a PNG (every browser since IE 9 reads them). */
function ico(images: Array<{ px: number; data: Buffer }>) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ px, data }, i) => {
    const at = 6 + 16 * i
    head.writeUInt8(px % 256, at)
    head.writeUInt8(px % 256, at + 1)
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(data.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map((image) => image.data)])
}

const favicon = mark()
writeFileSync('public/favicon.svg', favicon)
writeFileSync('public/favicon.ico', ico(await Promise.all([16, 32, 48].map(async (px) => ({ px, data: await png(favicon, px) })))))
writeFileSync('public/apple-touch-icon.png', await png(mark({ round: false, fill: 0.58 }), 180))
writeFileSync('public/icon-192.png', await png(favicon, 192))
writeFileSync('public/icon-512.png', await png(favicon, 512))
// Android masks this to a circle or a squircle: everything that matters inside the middle 80%.
writeFileSync('public/icon-maskable-512.png', await png(mark({ round: false, fill: 0.46 }), 512))
writeFileSync(
  'public/manifest.webmanifest',
  `${JSON.stringify(
    {
      name: config.author,
      short_name: config.author.split(' ').at(-1),
      description: `${config.author}, ${config.tagline}.`,
      start_url: '/',
      display: 'browser',
      background_color: '#13120f',
      theme_color: '#13120f',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  )}\n`,
)
console.log('public/: favicon.svg, favicon.ico (16, 32, 48), apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png, manifest.webmanifest')

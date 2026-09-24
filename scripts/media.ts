// Copies content/media/ into the build and makes web-sized .webp copies of
// every photo (the widths load.ts's mediaVariants() promises), so a 12 MB
// phone photo ships as a ~100 KB image sized for its column.
import { existsSync } from 'node:fs'
import { cp, readdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { IMAGE_FILE, MEDIA_DIR, mediaVariants } from '../src/content/load'

export async function buildMedia(outDir: string) {
  if (!existsSync(MEDIA_DIR)) return 0
  // Originals too: videos, and images linked from article bodies.
  await cp(MEDIA_DIR, outDir, { recursive: true, filter: (src) => !path.basename(src).startsWith('.') })
  let count = 0
  for (const entry of await readdir(MEDIA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(MEDIA_DIR, entry.name)
    for (const file of await readdir(dir)) {
      if (!IMAGE_FILE.test(file)) continue
      const input = path.join(dir, file)
      const { width = 0, height = 0, orientation = 1 } = await sharp(input).metadata()
      // EXIF orientations 5–8 are rotated 90°, so the displayed width is the stored height.
      const displayWidth = orientation >= 5 ? height : width
      for (const variant of mediaVariants(file, displayWidth)) {
        await sharp(input)
          .rotate()
          .resize({ width: variant.width, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(path.join(outDir, entry.name, variant.name))
        count++
      }
    }
  }
  return count
}

/**
 * Swaps a canvas that's done drawing for a picture of it. A canvas holds its
 * whole bitmap in memory, 4 bytes a pixel (a few MB on a big screen); a
 * picture is kept compressed and decoded only while it's on screen. The
 * snapshot is taken now; the canvas stays up until the picture is ready to
 * take its place, so nothing flickers. `then` runs after the swap (say, to
 * let go of the canvas's graphics card).
 */
export function keepAsPicture(canvas: HTMLCanvasElement, className: string, then?: () => void) {
  canvas.toBlob((blob) => {
    const done = () => {
      // Hand the bitmap back now, rather than whenever the canvas is collected.
      canvas.width = canvas.height = 0
      then?.()
    }
    if (!blob || !canvas.parentNode) return done()
    const img = document.createElement('img')
    img.className = className
    img.alt = ''
    const url = URL.createObjectURL(blob)
    img.src = url
    void img
      .decode()
      .catch(() => undefined)
      .then(() => {
        // Decoded and shown, the picture doesn't need its address any more.
        URL.revokeObjectURL(url)
        if (canvas.parentNode) canvas.replaceWith(img)
        done()
      })
  })
}

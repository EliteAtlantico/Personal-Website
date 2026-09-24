// The little of WebGL the globe needs: matrices, meshes and shader programs.
// It used to be three.js (about 580 KB); everything here reproduces what the
// globe used from it (a perspective camera, spheres, flat circles and rings,
// a tube along a curve, points) the same way three.js built them, so it looks
// the same, in about 1/40th of the code.

export type Vec3 = [number, number, number]

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a)
  return l ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** The point a fraction t of the way along the great circle from a to b (both unit vectors). */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const angle = Math.acos(Math.min(1, Math.max(-1, dot(a, b))))
  if (angle < 1e-6) return [...a]
  const s = Math.sin(angle)
  return add(scale(a, Math.sin((1 - t) * angle) / s), scale(b, Math.sin(t * angle) / s))
}

// --- Matrices (column-major, as WebGL takes them) ---

/** A perspective projection: vertical field of view in degrees, as three.js's PerspectiveCamera. */
export function perspective(fov: number, aspect: number, near: number, far: number, out = new Float32Array(16)) {
  const f = 1 / Math.tan((fov * Math.PI) / 360)
  const nf = 1 / (near - far)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) * nf
  out[11] = -1
  out[14] = 2 * far * near * nf
  return out
}

/** The view from `eye` towards the origin, with +y up. */
export function lookAtOrigin(eye: Vec3, out = new Float32Array(16)) {
  let z = normalize(eye)
  let x = cross([0, 1, 0], z)
  // Looking straight down (or up): nudge, as three.js does.
  if (!length(x)) {
    z = normalize([z[0], z[1], z[2] + 0.0001])
    x = cross([0, 1, 0], z)
  }
  x = normalize(x)
  const y = cross(z, x)
  out.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1])
  return out
}

export function multiply(a: Float32Array, b: Float32Array, out = new Float32Array(16)) {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** The upper-left 3×3 of a view matrix: for a camera that only moves and turns, the normal matrix. */
export function normalMatrix(view: Float32Array, out = new Float32Array(9)) {
  out.set([view[0]!, view[1]!, view[2]!, view[4]!, view[5]!, view[6]!, view[8]!, view[9]!, view[10]!])
  return out
}

/** A point's place on screen (px from the top left), and whether it's in front of the camera. */
export function project(m: Float32Array, p: Vec3, width: number, height: number, out = { x: 0, y: 0 }) {
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!
  out.x = (((m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!) / w + 1) / 2) * width
  out.y = ((1 - (m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!) / w) / 2) * height
  return out
}

// --- Meshes, built as three.js builds them ---

export interface Mesh {
  positions: Float32Array
  normals?: Float32Array
  /** Along the mesh, 0 to 1 (the tube's uv.x). */
  along?: Float32Array
  indices?: Uint16Array
}

/** SphereGeometry(radius, widthSegments, heightSegments). */
export function sphere(radius: number, across: number, down: number): Mesh {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (let iy = 0; iy <= down; iy++) {
    const v = iy / down
    for (let ix = 0; ix <= across; ix++) {
      const u = ix / across
      const p: Vec3 = [-radius * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI), radius * Math.cos(v * Math.PI), radius * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI)]
      positions.push(...p)
      normals.push(...normalize(p))
    }
  }
  const at = (ix: number, iy: number) => iy * (across + 1) + ix
  for (let iy = 0; iy < down; iy++) {
    for (let ix = 0; ix < across; ix++) {
      const [a, b, c, d] = [at(ix + 1, iy), at(ix, iy), at(ix, iy + 1), at(ix + 1, iy + 1)]
      if (iy !== 0) indices.push(a, b, d)
      if (iy !== down - 1) indices.push(b, c, d)
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) }
}

/**
 * A flat mark lying on the globe at `center` (a unit vector times its height),
 * facing out: CircleGeometry (inner 0) or RingGeometry, turned the way
 * three.js's lookAt turned it. Positions are offsets from the centre, so a
 * ring can be scaled about it.
 */
export function mark(center: Vec3, inner: number, outer: number, segments: number): Mesh {
  const z = normalize(center)
  let x = cross([0, 1, 0], z)
  if (!length(x)) x = [1, 0, 0]
  x = normalize(x)
  const y = cross(z, x)
  const point = (r: number, angle: number) => add(scale(x, r * Math.cos(angle)), scale(y, r * Math.sin(angle)))
  const positions: number[] = []
  const indices: number[] = []
  if (!inner) {
    positions.push(0, 0, 0)
    for (let s = 0; s <= segments; s++) positions.push(...point(outer, (s / segments) * Math.PI * 2))
    for (let i = 1; i <= segments; i++) indices.push(i, i + 1, 0)
  } else {
    for (const r of [inner, outer]) for (let i = 0; i <= segments; i++) positions.push(...point(r, (i / segments) * Math.PI * 2))
    for (let i = 0; i < segments; i++) {
      const [a, b, c, d] = [i, i + segments + 1, i + segments + 2, i + 1]
      indices.push(a, b, d, b, c, d)
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) }
}

/**
 * TubeGeometry along a curve that lies in a plane through the globe's centre
 * (`normal` is the plane's): `along` sections spaced evenly by length, each a
 * ring of `around` sides, with how far along each vertex is (uv.x).
 */
export function tube(curve: (t: number) => Vec3, planeNormal: Vec3, along: number, radius: number, around: number): Mesh {
  // Even steps by length along the curve, not by t: a table of lengths, inverted.
  const fine = 2048
  const points = Array.from({ length: fine + 1 }, (_, i) => curve(i / fine))
  const lengths = [0]
  for (let i = 1; i <= fine; i++) lengths.push(lengths[i - 1]! + length(add(points[i]!, scale(points[i - 1]!, -1))))
  const total = lengths[fine]!
  const at = (u: number) => {
    const target = u * total
    let lo = 0
    let hi = fine
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (lengths[mid]! < target) lo = mid
      else hi = mid
    }
    const span = lengths[hi]! - lengths[lo]!
    const f = span ? (target - lengths[lo]!) / span : 0
    return add(scale(points[lo]!, 1 - f), scale(points[hi]!, f))
  }
  const positions: number[] = []
  const alongs: number[] = []
  const indices: number[] = []
  const b = normalize(planeNormal)
  for (let i = 0; i <= along; i++) {
    const u = i / along
    const p = at(u)
    const t = normalize(add(at(Math.min(1, u + 1e-4)), scale(at(Math.max(0, u - 1e-4)), -1)))
    // The frame: the plane's normal, and the one in the plane (a right-handed tangent, normal, binormal).
    const n = cross(b, t)
    for (let j = 0; j <= around; j++) {
      const v = (j / around) * Math.PI * 2
      positions.push(...add(p, scale(add(scale(n, -Math.cos(v)), scale(b, Math.sin(v))), radius)))
      alongs.push(u)
    }
  }
  for (let i = 1; i <= along; i++) {
    for (let j = 1; j <= around; j++) {
      const [a, bb, c, d] = [(around + 1) * (i - 1) + (j - 1), (around + 1) * i + (j - 1), (around + 1) * i + j, (around + 1) * (i - 1) + j]
      indices.push(a, bb, d, bb, c, d)
    }
  }
  return { positions: new Float32Array(positions), along: new Float32Array(alongs), indices: new Uint16Array(indices) }
}

// --- GPU side ---

/** Where each attribute goes, fixed before linking (so nothing has to be asked of a program that's still compiling). */
export const ATTRIBUTES = { position: 0, normal: 1, along: 2, hot: 3 } as const

export interface Program {
  program: WebGLProgram
  uniforms: Record<string, WebGLUniformLocation | null>
}

/**
 * Starts compiling a program. With KHR_parallel_shader_compile the driver
 * compiles it in the background, and `ready` says when it's done, so the
 * page never stops for it; without, it's compiled on first use.
 */
export function compile(gl: WebGLRenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram()!
  const shaders = [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const
  for (const [type, source] of shaders) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    gl.attachShader(program, shader)
    // Flagged for deletion now; it goes when the program does.
    gl.deleteShader(shader)
  }
  for (const [name, index] of Object.entries(ATTRIBUTES)) gl.bindAttribLocation(program, index, name)
  gl.linkProgram(program)
  return program
}

/** Whether a program has finished compiling (always, without the extension). */
export function compiled(gl: WebGLRenderingContext, program: WebGLProgram, parallel: { COMPLETION_STATUS_KHR: number } | null) {
  return !parallel || !!gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)
}

/** The finished program's uniforms (by name), or null if it didn't link. */
export function linked(gl: WebGLRenderingContext, program: WebGLProgram, names: string[]): Program | null {
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program))
    return null
  }
  return { program, uniforms: Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) }
}

export interface Buffers {
  attributes: Array<{ buffer: WebGLBuffer; index: number; size: number }>
  indices: WebGLBuffer | null
  count: number
}

/** A mesh's vertex data on the graphics card (`hot`, which changes as stories light up, is kept ready for updates). */
export function upload(gl: WebGLRenderingContext, mesh: Mesh & { hot?: Float32Array }): Buffers {
  const attributes: Buffers['attributes'] = []
  const attribute = (data: Float32Array | undefined, index: number, size: number, usage: number = gl.STATIC_DRAW) => {
    if (!data) return
    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, usage)
    attributes.push({ buffer, index, size })
  }
  attribute(mesh.positions, ATTRIBUTES.position, 3)
  attribute(mesh.normals, ATTRIBUTES.normal, 3)
  attribute(mesh.along, ATTRIBUTES.along, 1)
  attribute(mesh.hot, ATTRIBUTES.hot, 1, gl.DYNAMIC_DRAW)
  let indices: WebGLBuffer | null = null
  if (mesh.indices) {
    indices = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
  }
  return { attributes, indices, count: mesh.indices?.length ?? mesh.positions.length / 3 }
}

/** Draws a mesh (triangles, or points), with only its own attributes switched on. */
export function draw(gl: WebGLRenderingContext, buffers: Buffers, mode: number) {
  for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i)
  for (const { buffer, index, size } of buffers.attributes) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(index)
    gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0)
  }
  if (buffers.indices) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices)
    gl.drawElements(mode, buffers.count, gl.UNSIGNED_SHORT, 0)
  } else gl.drawArrays(mode, 0, buffers.count)
}

let painter: CanvasRenderingContext2D | null = null

/**
 * A computed CSS colour as red, green and blue from 0 to 1. Browsers give
 * computed colours as rgb() or rgba(), read here directly; anything else
 * (color(), oklch()) is painted on a one-pixel canvas and read back.
 */
export function rgb(color: string): Vec3 {
  const plain = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(color)
  if (plain) return [Number(plain[1]) / 255, Number(plain[2]) / 255, Number(plain[3]) / 255]
  if (!painter) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    painter = canvas.getContext('2d', { willReadFrequently: true })!
  }
  painter.clearRect(0, 0, 1, 1)
  painter.fillStyle = color
  painter.fillRect(0, 0, 1, 1)
  const [r, g, b] = painter.getImageData(0, 0, 1, 1).data
  return [r! / 255, g! / 255, b! / 255]
}

export const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

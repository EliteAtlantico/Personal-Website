// What the shell prints: lines made of styled pieces of text. Commands build
// these as plain data, so they can be tested without a browser; index.ts turns
// them into DOM.

export type Style = 'dir' | 'file' | 'dim' | 'accent' | 'green' | 'strong' | 'em' | 'code' | 'heading' | 'error' | 'match'

export interface Segment {
  text: string
  style?: Style
  /** Clicking it runs this command, as if it had been typed. */
  run?: string
  /** Clicking it puts this in the prompt (for commands that need an argument). */
  fill?: string
  /** A real link: a page on this site, or elsewhere. */
  href?: string
}

export interface Line {
  segments: Segment[]
  /** Wrapped text lines up this many characters in (lists, labelled fields). */
  hang?: number
  /** Lay the segments out in columns, like ls does. */
  grid?: boolean
  /** Not text at all: a dashboard of panes, laid out like the paper's front page. */
  panes?: Pane[]
}

/** A story in a dashboard pane: its name, a dim detail on the right, and where clicking takes you. */
export interface Row {
  label: string
  detail?: string
  run?: string
  href?: string
}

/** A titled box, like a tmux pane. */
export interface Pane {
  title: string
  /** Dim text at the right end of the title bar. */
  note?: string
  /** Where it sits: the lead story, the column beside it, or with the desks below (the default). */
  area?: 'lead' | 'side'
  lines?: Line[]
  rows?: Row[]
  /** Links along the bottom of the pane. */
  links?: Segment[]
  /** A story (by slug) whose words rain down the pane's spare room (rain.ts). */
  rain?: string
}

export const seg = (text: string, style?: Style): Segment => (style ? { text, style } : { text })
export const line = (...segments: Array<Segment | string>): Line => ({ segments: segments.map((s) => (typeof s === 'string' ? { text: s } : s)) })
export const blank = (): Line => ({ segments: [] })
export const error = (text: string): Line => line(seg(text, 'error'))

/** A label padded to a fixed width, then its value, with wrapped lines aligned under the value. */
export const field = (label: string, value: Array<Segment | string> | string, width = 10): Line => ({
  ...line(seg(label.padEnd(width), 'dim'), ...(typeof value === 'string' ? [value] : value)),
  hang: width,
})

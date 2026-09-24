// The shape of everything in content/. Frontmatter in content/items/*.md is
// parsed into an Item by load.ts; content/site.json becomes the SiteConfig.

export const SECTIONS = ['now', 'research', 'work', 'projects', 'clubs', 'speaking', 'education', 'story', 'hobbies'] as const
export type Section = (typeof SECTIONS)[number]

export interface Link {
  label: string
  url: string
}

export type Media =
  | { type: 'youtube'; id: string; title?: string }
  | { type: 'image'; src: string; alt: string; caption?: string }

/** A tile's photo or looping video. Dimensions are read from the file at build time. */
export interface Cover {
  kind: 'image' | 'video'
  /** Image URL, or the video file for kind "video". */
  src: string
  /** Responsive image candidates ("url 480w, …"), production builds only. */
  srcset?: string
  /** Still frame shown before a video plays. */
  poster?: string
  width: number
  height: number
  alt: string
}

export interface Publication {
  venue: string
  title: string
  position?: string
  status?: string
}

/** How much each kind of visitor cares about an item (0–3). Used for ordering in stage 4. */
export interface Audience {
  recruiter: number
  research: number
  dev: number
}

export interface Item {
  slug: string
  section: Section
  /** Overrides the section's desk name on the front page (e.g. "From the Archives"). */
  desk?: string
  title: string
  /** Newspaper-style headline; falls back to title. */
  headline?: string
  org?: string
  role?: string
  dates?: string
  status?: string
  place?: string
  remote: boolean
  team: string[]
  tags: string[]
  audience: Audience
  blurb: string
  /** True when the blurb was cut from the body, so the tile reads "Continued inside". */
  excerpt: boolean
  /** How many front-page columns the tile spans (1–3). */
  span: number
  cover?: Cover
  stack: string[]
  outcomes: string[]
  datasets: string[]
  links: Link[]
  media: Media[]
  publication?: Publication
  paper?: string
  updated?: string
  /** Opening paragraphs of the body as plain text, for the lead story's front-page "jump". */
  lede: string[]
  bodyHtml: string
  draft: boolean
}

export interface Desk {
  name: string
  items: string[]
  variant?: 'briefs'
}

export interface SiteConfig {
  author: string
  tagline: string
  edition: string
  lead: string
  /** Stories shown under the lead, side by side. */
  secondary: string[]
  rail: string[]
  desks: Desk[]
  sectionNames: Record<Section, string>
  links: Link[]
  /** Optional masthead banner, a file in content/media/site/ (e.g. { "src": "banner.jpg", "alt": "…" }). */
  banner?: {
    src: string
    alt: string
    /** Vertical slice of the photo squeezed into the strip, as fractions of its height ([top, bottom]). */
    band?: [number, number]
    /** "tone" shades letters by brightness; "silhouette" sets a skyline: dense text for the city, faint for the sky. */
    mode?: 'tone' | 'silhouette'
    /** A landmark to emphasize, drawn in the accent colour. */
    landmark?: {
      label: string
      /** Outline as [x, y] fractions of the photo's width and height. */
      outline: Array<[number, number]>
    }
    /**
     * Silhouette mode's rooftops, found in the photo at build time (content/load.ts), not
     * written in site.json: "<width>x<height>:" then each column's rooftop row, as the change
     * from the column before. With it, visitors' browsers never need the photo itself.
     */
    skyline?: string
  }
}

export interface Bio {
  title: string
  text: string
}

export interface Site {
  config: SiteConfig
  items: Item[]
  bio?: Bio
  banner?: Cover
  builtAt: string
}

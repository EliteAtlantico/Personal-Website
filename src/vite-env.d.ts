/// <reference types="vite/client" />

declare module 'virtual:content' {
  const site: import('./content/types').Site
  export default site
}

declare module 'virtual:land' {
  /** One bit per globe dot, set for land (src/globe/land.ts), as base64. */
  const bits: string
  export default bits
}

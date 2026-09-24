/// <reference types="vite/client" />

declare module 'virtual:content' {
  const site: import('./content/types').Site
  export default site
}

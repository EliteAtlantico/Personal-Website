// hyphen ships no types (and is CommonJS, so import its default export). Only the build-time loader uses it.
declare module 'hyphen/en-us/index.js' {
  const hyphen: { hyphenateSync(text: string, options?: { minWordLength?: number; hyphenChar?: string }): string }
  export default hyphen
}

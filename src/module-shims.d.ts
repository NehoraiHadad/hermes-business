// Electron main-process modules (.cjs) and build scripts (.mjs) are plain
// JavaScript outside the typed `src` graph. A few unit tests import them
// directly to exercise the real implementation; treat them as untyped here so
// `tsc` does not flag the cross-boundary imports.
declare module '*.cjs'
declare module '*.mjs'

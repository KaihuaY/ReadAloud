/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by Vite's `define` in vite.config.ts as "<git short sha> <ISO
// date>" (falls back to "dev" when the build isn't inside a git checkout).
// See src/buildInfo.ts for the guarded re-export other code should import.
declare const __APP_BUILD__: string

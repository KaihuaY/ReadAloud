// Build identity, shown at the bottom of Settings so a parent can tell which
// version a device is running, and used by store/progress.ts to detect a
// stale cached build (see loadInitialDoc's automatic-backup trigger).
// __APP_BUILD__ is injected by Vite's `define` (see vite.config.ts, and the
// matching `define` in vitest.config.ts for tests) as "<git short sha>
// <ISO date>"; the typeof guard keeps this importable anywhere that
// replacement never ran (e.g. a stray node/ts-node script).
export const APP_BUILD: string = typeof __APP_BUILD__ === 'undefined' ? 'dev' : __APP_BUILD__

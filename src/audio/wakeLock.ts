// Keeps the screen on while a piano take is recording, when the platform
// supports the Screen Wake Lock API. iOS Safari has historically not
// supported it, so callers must treat `supported: false` as normal and show
// a "keep the screen on" hint instead of relying on this.

export interface WakeLockHandle {
  supported: boolean
  release(): void
}

interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
}

interface WakeLockNavigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>
  }
}

function noop(): void {
  // no-op release for unsupported platforms
}

export async function acquireWakeLock(): Promise<WakeLockHandle> {
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as WakeLockNavigator) : undefined
  const wakeLockApi = nav?.wakeLock
  if (!wakeLockApi) {
    return { supported: false, release: noop }
  }

  const api = wakeLockApi

  let sentinel: WakeLockSentinelLike | null = null
  try {
    sentinel = await api.request('screen')
  } catch {
    return { supported: false, release: noop }
  }

  let released = false

  function onVisibilityChange(): void {
    if (released) return
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
    if (sentinel !== null && !sentinel.released) return
    api
      .request('screen')
      .then((s) => {
        sentinel = s
      })
      .catch(() => {
        sentinel = null
      })
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  return {
    supported: true,
    release(): void {
      if (released) return
      released = true
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
      if (sentinel !== null && !sentinel.released) {
        void sentinel.release()
      }
      sentinel = null
    },
  }
}

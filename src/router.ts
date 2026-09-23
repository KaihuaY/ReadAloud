import { useCallback, useEffect, useState } from 'react'

// A tiny hash router - no react-router. Good enough for a handful of
// top-level screens (#/home, #/library, ...) with the occasional :param.

const ROUTE_PATTERNS = ['/home', '/library', '/read/:passageId', '/tricky', '/box', '/review', '/settings', '/credits']

export interface Route {
  path: string
  params: Record<string, string>
  navigate: (path: string) => void
}

function currentHashPath(): string {
  if (typeof window === 'undefined') return '/home'
  const hash = window.location.hash
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  // Drop any ?query (e.g. dev flags like ?fakeMic=1) so it never breaks route matching.
  const path = raw.split('?')[0]
  return path || '/home'
}

/** Whether `path` belongs to the "read" area (Books tab) - for nav highlighting and "go back to where she was". */
export function isInArea(path: string, area: 'read'): boolean {
  if (area !== 'read') return false
  return path === '/library' || path.startsWith('/read/') || path === '/tricky'
}

function matchParams(path: string): Record<string, string> {
  const pathSegments = path.split('/').filter(Boolean)
  for (const pattern of ROUTE_PATTERNS) {
    const patternSegments = pattern.split('/').filter(Boolean)
    if (patternSegments.length !== pathSegments.length) continue

    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < patternSegments.length; i++) {
      const part = patternSegments[i]
      const segment = pathSegments[i]
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segment)
      } else if (part !== segment) {
        matched = false
        break
      }
    }
    if (matched) return params
  }
  return {}
}

export function navigate(path: string): void {
  if (typeof window === 'undefined') return
  window.location.hash = path.startsWith('/') ? path : `/${path}`
}

export function useRoute(): Route {
  const [path, setPath] = useState<string>(() => currentHashPath())

  useEffect(() => {
    const onHashChange = () => setPath(currentHashPath())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const go = useCallback((next: string) => navigate(next), [])

  return { path, params: matchParams(path), navigate: go }
}

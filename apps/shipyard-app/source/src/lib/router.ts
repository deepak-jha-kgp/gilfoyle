/** A hash router, because the app is served in an iframe and a path router
 *  would fight the host's own history. Four lines beats a dependency. */
import { useEffect, useState } from 'react'

export function useRoute(): [string, (to: string) => void] {
  const read = () => (typeof window === 'undefined' ? '' : window.location.hash.replace(/^#\/?/, ''))
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (to: string) => { window.location.hash = `/${to.replace(/^\/+/, '')}` }
  return [route, go]
}

export function routeParts(route: string): { view: string; id: string | null } {
  const [view = '', ...rest] = route.split('/')
  return { view: view || 'signals', id: rest.length ? decodeURIComponent(rest.join('/')) : null }
}

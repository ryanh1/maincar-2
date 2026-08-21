import { useEffect, useState } from 'react'

/**
 * Whether this browser currently has a network connection.
 *
 * `navigator.onLine` is a browser-level signal, not a Maincar API check — it
 * goes false when the machine has no network at all, and is the one thing a
 * rep about to dial genuinely needs to know before blaming their headset.
 */
export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return { online }
}

import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

export const googleReturnUrl = 'relay://sso-callback'

/** Brings a finished Google sign-in from Safari back into the app. */
export function GoogleReturn() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let remove = () => {}
    void App.addListener('appUrlOpen', ({ url }) => {
      if (!url.startsWith(googleReturnUrl)) return
      const incoming = new URL(url)
      window.location.replace(`/sso-callback${incoming.search}${incoming.hash}`)
    }).then((handle) => {
      remove = () => {
        void handle.remove()
      }
    })
    return () => remove()
  }, [])

  return null
}

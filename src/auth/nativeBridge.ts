type ClerkHost = Window & {
  Clerk?: { __internal_windowNavigate?: (url: string) => void }
  webkit?: { messageHandlers?: { relayOAuth?: { postMessage: (body: string) => void } } }
}

/**
 * Inside the iOS app the provider page must open in Safari, which sends the user back to relay://.
 * Returns a function that puts Clerk's own navigation back.
 */
export function routeProviderThroughNativeBridge(): () => void {
  const host = window as ClerkHost
  const clerk = host.Clerk
  const original = clerk?.__internal_windowNavigate
  if (!clerk || !original) return () => {}
  clerk.__internal_windowNavigate = (url: string) => {
    clerk.__internal_windowNavigate = original
    const bridge = host.webkit?.messageHandlers?.relayOAuth
    if (bridge) bridge.postMessage(url)
    else window.location.assign(url)
  }
  return () => {
    clerk.__internal_windowNavigate = original
  }
}

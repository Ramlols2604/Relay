export type SocialProvider = 'apple' | 'google'

export const socialProviders: readonly { id: SocialProvider; strategy: 'oauth_apple' | 'oauth_google'; label: string }[] = [
  { id: 'apple', strategy: 'oauth_apple', label: 'Apple' },
  { id: 'google', strategy: 'oauth_google', label: 'Google' },
]

/** Where Clerk sends the browser after the provider, so the web app and the iOS app both come back to Relay. */
export function socialRedirects(native: boolean, nativeReturnUrl: string) {
  return native
    ? { redirectUrl: nativeReturnUrl, redirectCallbackUrl: nativeReturnUrl }
    : { redirectUrl: '/', redirectCallbackUrl: '/sso-callback' }
}

export function socialButtonLabel(provider: { label: string }, signUp: boolean) {
  return `${signUp ? 'Sign up' : 'Continue'} with ${provider.label}`
}

/** Clerk's own social buttons and divider are hidden so only Relay's buttons show. */
export const clerkAppearance = {
  variables: { colorPrimary: '#147a4c', fontFamily: '"Nunito", system-ui, sans-serif' },
  elements: {
    rootBox: 'relay-clerk-root',
    cardBox: 'relay-clerk-card',
    card: 'relay-clerk-card-body',
    header: 'relay-clerk-header',
    socialButtonsRoot: 'relay-clerk-hidden',
    dividerRow: 'relay-clerk-hidden',
  },
}

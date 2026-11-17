import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useSignIn } from '@clerk/react-router'
import { googleReturnUrl } from './googleSignIn.tsx'
import { routeProviderThroughNativeBridge } from './nativeBridge.ts'
import { socialButtonLabel, socialProviders, socialRedirects, type SocialProvider } from './providers.ts'

/** Apple and Google sign-in. New accounts are created by Clerk on return, so this serves sign up too. */
export function SocialSignIn({ signUp = false }: { signUp?: boolean }) {
  const { signIn } = useSignIn()
  const [busy, setBusy] = useState<SocialProvider | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const native = Capacitor.isNativePlatform()

  const start = async (provider: (typeof socialProviders)[number]) => {
    if (busy) return
    setBusy(provider.id)
    setProblem(null)
    const restore = native ? routeProviderThroughNativeBridge() : () => {}
    try {
      const result = await signIn.sso({ strategy: provider.strategy, ...socialRedirects(native, googleReturnUrl) })
      if (result?.error) throw result.error
    } catch {
      restore()
      setProblem(`${provider.label} sign-in could not start. Try again or use email.`)
      setBusy(null)
    }
  }

  return (
    <div className="relay-social">
      {socialProviders.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={`relay-social-button relay-social-${provider.id}`}
          disabled={busy !== null}
          onClick={() => void start(provider)}
        >
          {socialButtonLabel(provider, signUp)}
        </button>
      ))}
      {problem ? (
        <p className="relay-social-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <p className="relay-social-divider" aria-hidden="true">
        <span>or use your email</span>
      </p>
    </div>
  )
}

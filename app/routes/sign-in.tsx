import { SignIn } from '@clerk/react-router'
import { Capacitor } from '@capacitor/core'
import { AuthPage } from '../../src/App.tsx'
import { SocialSignIn } from '../../src/auth/SocialSignIn.tsx'
import { clerkAppearance } from '../../src/auth/providers.ts'

export default function SignInPage() {
  const native = Capacitor.isNativePlatform()
  return (
    <AuthPage>
      <div className={native ? 'relay-native-auth' : undefined}>
        <SocialSignIn />
        <SignIn routing="hash" signUpUrl="/signup" appearance={clerkAppearance} />
      </div>
    </AuthPage>
  )
}

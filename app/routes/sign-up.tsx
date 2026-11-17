import { SignUp } from '@clerk/react-router'
import { AuthPage } from '../../src/App.tsx'
import { SocialSignIn } from '../../src/auth/SocialSignIn.tsx'
import { clerkAppearance } from '../../src/auth/providers.ts'

export default function SignUpPage() {
  return (
    <AuthPage signUp>
      <SocialSignIn signUp />
      <SignUp routing="hash" signInUrl="/sign-in" appearance={clerkAppearance} />
    </AuthPage>
  )
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { clerkAppearance, socialButtonLabel, socialProviders, socialRedirects } from './providers.ts'

test('Apple and Google are offered, in that order', () => {
  assert.deepEqual(
    socialProviders.map((provider) => provider.strategy),
    ['oauth_apple', 'oauth_google'],
  )
})

test('web returns through the SSO callback route, native through the app URL', () => {
  assert.deepEqual(socialRedirects(false, 'relay://sso-callback'), { redirectUrl: '/', redirectCallbackUrl: '/sso-callback' })
  assert.deepEqual(socialRedirects(true, 'relay://sso-callback'), {
    redirectUrl: 'relay://sso-callback',
    redirectCallbackUrl: 'relay://sso-callback',
  })
})

test('labels differ between sign in and sign up', () => {
  assert.equal(socialButtonLabel(socialProviders[0], false), 'Continue with Apple')
  assert.equal(socialButtonLabel(socialProviders[1], true), 'Sign up with Google')
})

test('Clerk social buttons are hidden so there are no duplicates', () => {
  assert.equal(clerkAppearance.elements.socialButtonsRoot, 'relay-clerk-hidden')
})

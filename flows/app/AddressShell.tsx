import { useState, type FormEvent } from 'react'
import { api } from '../../src/api/client.ts'
import { AddressAutocomplete } from '../../src/components/AddressAutocomplete.tsx'
import {
  isDemoStreetAddress,
  type VerifiedAddress,
} from '../../src/data/addressVerify.ts'

const USER_ID = 'user_flow_addr'

/**
 * Minimal onboarding/edit surface for address verification flows with a mocked geocoder.
 */
export function AddressShell() {
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('Cary')
  const [verified, setVerified] = useState<VerifiedAddress | null>(null)
  const [geocoderDown, setGeocoderDown] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<{
    address_verified?: boolean
    formatted_address?: string
    latitude?: number | null
    longitude?: number | null
  } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (isDemoStreetAddress(street)) {
      setError('Replace the demo address (14 Willow Court) with your real street.')
      return
    }
    if (!geocoderDown && !verified) {
      setError('Pick an address suggestion to verify your street.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const profile = await api.saveProfile({
        clerk_user_id: USER_ID,
        name: 'Flow Neighbor',
        email: 'flow@example.test',
        initials: 'FN',
        street: verified?.street ?? street.trim(),
        city: verified?.city ?? city.trim(),
        about: '',
        latitude: verified?.latitude ?? null,
        longitude: verified?.longitude ?? null,
        formatted_address: verified?.formattedAddress ?? null,
        state: verified?.state ?? null,
      })
      setSaved(profile)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page" data-testid="address-shell">
      <form className="glass-card login-card welcome-form" onSubmit={(event) => void submit(event)}>
        <h1>Verify address</h1>
        <AddressAutocomplete
          street={street}
          city={city}
          verified={verified}
          onStreetChange={setStreet}
          onCityChange={setCity}
          onVerifiedChange={setVerified}
          onGeocoderUnavailable={() => setGeocoderDown(true)}
          disabled={busy}
        />
        {error ? <p className="login-status" data-testid="address-shell-error">{error}</p> : null}
        <button type="submit" className="login-submit" disabled={busy} data-testid="address-shell-save">
          {busy ? 'Saving…' : 'Save address'}
        </button>
        {saved ? (
          <p data-testid="address-shell-saved">
            {saved.address_verified ? 'verified' : 'unverified'}|{saved.formatted_address || ''}|
            {saved.latitude ?? ''}|{saved.longitude ?? ''}
          </p>
        ) : null}
      </form>
    </div>
  )
}

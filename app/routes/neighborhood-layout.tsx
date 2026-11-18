import { useState, type FormEvent } from 'react'
import { Show } from '@clerk/react-router'
import { api } from '../../src/api/client.ts'
import { AddressAutocomplete } from '../../src/components/AddressAutocomplete.tsx'
import { AppLayout } from '../../src/components/AppLayout.tsx'
import {
  isDemoStreetAddress,
  type VerifiedAddress,
} from '../../src/data/addressVerify.ts'
import { ActivityFeedProvider } from '../../src/state/activityFeed.tsx'
import { CurrentResidentProvider } from '../../src/state/currentResident.tsx'
import { useCurrentResident } from '../../src/state/currentResidentStore.ts'
import { HandoffsProvider } from '../../src/state/handoffs.tsx'
import { InventoryProvider } from '../../src/state/inventory.tsx'
import { LoanRequestsProvider } from '../../src/state/loanRequests.tsx'
import { ShelfResidentProvider } from '../../src/state/shelfResident.tsx'
import SignInPage from './sign-in.tsx'

export default function NeighborhoodLayout() {
  return (
    <>
      <Show when="signed-out">
        <SignInPage />
      </Show>
      <Show when="signed-in">
        <CurrentResidentProvider>
          <SignedInApp />
        </CurrentResidentProvider>
      </Show>
    </>
  )
}

function SignedInApp() {
  const resident = useCurrentResident()

  if (!resident.id || !resident.profileReady) {
    return (
      <div className="hint" data-testid="shelf-loading">
        <p>Loading your shelf…</p>
      </div>
    )
  }

  if (!resident.onboarded) {
    return (
      <WelcomeForm
        residentId={resident.id}
        name={resident.name}
        email={resident.email}
        initials={resident.initials}
        onDone={() => void resident.refreshProfile()}
      />
    )
  }

  return (
    <ShelfResidentProvider residentId={resident.id}>
      <InventoryProvider residentId={resident.id}>
        <ActivityFeedProvider>
          <LoanRequestsProvider>
            <HandoffsProvider>
              {resident.offlineCached ? (
                <p className="hint offline-cache-notice" role="status">
                  Offline, showing saved info
                </p>
              ) : null}
              <AppLayout />
            </HandoffsProvider>
          </LoanRequestsProvider>
        </ActivityFeedProvider>
      </InventoryProvider>
    </ShelfResidentProvider>
  )
}

function WelcomeForm({
  residentId,
  name,
  email,
  initials,
  onDone,
}: {
  residentId: string
  name: string
  email: string
  initials: string
  onDone: () => void
}) {
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [about, setAbout] = useState('')
  const [itemName, setItemName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [verified, setVerified] = useState<VerifiedAddress | null>(null)
  const [geocoderDown, setGeocoderDown] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!street.trim()) {
      setError('Enter your street address.')
      return
    }
    if (!city.trim()) {
      setError('Enter the city you are in.')
      return
    }
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
      const saved = await api.saveProfile({
        clerk_user_id: residentId,
        name,
        email,
        initials,
        street: verified?.street ?? street.trim(),
        city: verified?.city ?? city.trim(),
        about: about.trim(),
        latitude: verified?.latitude ?? null,
        longitude: verified?.longitude ?? null,
        formatted_address: verified?.formattedAddress ?? null,
        state: verified?.state ?? null,
      })
      if (!saved.onboarded) {
        setError('Enter your street address and city.')
        return
      }
      const firstItem = itemName.trim()
      onDone()
      if (firstItem) {
        void api
          .createInventory(residentId, {
            name: firstItem,
            category: 'Household',
            quantity,
            condition: 'Good',
            notes: '',
            available_to_lend: true,
          })
          .catch(() => {
            /* Shelf can be filled later; do not block leaving welcome. */
          })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-content">
        <form className="glass-card login-card welcome-form" onSubmit={(event) => void submit(event)}>
          <h1>Where should Relay look?</h1>
          <p className="login-description">
            Enter the real street and city where you borrow and lend. Pick a Mapbox suggestion so
            Relay can verify the address. Matches stay in your city. You can change this later under
            Edit profile.
          </p>
          <div className="login-form">
            <AddressAutocomplete
              street={street}
              city={city}
              verified={verified}
              onStreetChange={setStreet}
              onCityChange={setCity}
              onVerifiedChange={setVerified}
              onGeocoderUnavailable={() => setGeocoderDown(true)}
              streetPlaceholder="22 Maple Street"
              cityPlaceholder="Cary"
              disabled={busy}
            />
            <p className="hint">
              Use your actual city name (for example Cary or Charlotte). Demo neighbors live in
              Charlotte for local testing only.
            </p>
            <label className="login-field">
              About you
              <input
                value={about}
                onChange={(event) => setAbout(event.target.value)}
                placeholder="I live near the park and lend tools."
              />
            </label>
            <label className="login-field">
              Something you have
              <input
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                placeholder="Ladder"
              />
            </label>
            <label className="login-field">
              Quantity
              <input
                type="number"
                min={1}
                max={99}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value) || 1)}
              />
            </label>
            {error ? <p className="login-status">{error}</p> : null}
            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? 'Saving…' : 'Join your city'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

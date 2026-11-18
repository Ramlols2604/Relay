import { useEffect, useId, useRef, useState } from 'react'
import {
  ADDRESS_DEBOUNCE_MS,
  ADDRESS_MIN_CHARS,
  isDemoStreetAddress,
  suggestAddresses,
  type AddressSuggestion,
  type VerifiedAddress,
} from '../data/addressVerify.ts'

type AddressAutocompleteProps = {
  street: string
  city: string
  onStreetChange: (value: string) => void
  onCityChange: (value: string) => void
  onVerifiedChange: (value: VerifiedAddress | null) => void
  verified: VerifiedAddress | null
  disabled?: boolean
  streetPlaceholder?: string
  cityPlaceholder?: string
  onGeocoderUnavailable?: () => void
}

export function AddressAutocomplete({
  street,
  city,
  onStreetChange,
  onCityChange,
  onVerifiedChange,
  verified,
  disabled = false,
  streetPlaceholder = '100 Main Street',
  cityPlaceholder = 'Cary',
  onGeocoderUnavailable,
}: AddressAutocompleteProps) {
  const listId = useId()
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [looking, setLooking] = useState(false)
  const [lookupNote, setLookupNote] = useState('')
  const [tokenMissing, setTokenMissing] = useState(false)
  const blurTimer = useRef(0)
  const requestId = useRef(0)

  const demo = isDemoStreetAddress(street)
  const canLookup = !tokenMissing && !demo && street.trim().length >= ADDRESS_MIN_CHARS
  const visibleSuggestions = canLookup ? suggestions : []

  useEffect(() => {
    if (!canLookup) return
    const id = ++requestId.current
    const timer = window.setTimeout(() => {
      setLooking(true)
      void suggestAddresses(street, city)
        .then((result) => {
          if (id !== requestId.current) return
          if (result.tokenMissing) {
            setTokenMissing(true)
            onGeocoderUnavailable?.()
            setSuggestions([])
            setLookupNote('')
            return
          }
          setSuggestions(result.suggestions)
          setOpen(result.suggestions.length > 0)
          setLookupNote(
            result.suggestions.length === 0
              ? "We couldn't find that exact address. Check the street number and spelling."
              : '',
          )
        })
        .catch(() => {
          if (id !== requestId.current) return
          setSuggestions([])
          setLookupNote("We couldn't find that exact address. Check the street number and spelling.")
        })
        .finally(() => {
          if (id === requestId.current) setLooking(false)
        })
    }, ADDRESS_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
    // onGeocoderUnavailable is optional UI feedback; omit from deps to avoid re-fetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [canLookup, street, city])

  function pick(suggestion: AddressSuggestion) {
    onStreetChange(suggestion.street)
    onCityChange(suggestion.city)
    onVerifiedChange({
      street: suggestion.street,
      city: suggestion.city,
      state: suggestion.state,
      formattedAddress: suggestion.formattedAddress,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
    })
    setSuggestions([])
    setOpen(false)
    setLookupNote('')
  }

  function onStreetTyped(value: string) {
    onStreetChange(value)
    if (verified) onVerifiedChange(null)
  }

  function onCityTyped(value: string) {
    onCityChange(value)
    if (verified) onVerifiedChange(null)
  }

  let status = ''
  if (tokenMissing) {
    status = 'Mapbox token missing — you can continue unverified until it is configured.'
  } else if (demo) {
    status = 'Replace the demo address (14 Willow Court) with your real street.'
  } else if (verified) {
    status = `Address verified: ${verified.formattedAddress}`
  } else if (looking) {
    status = 'Looking up addresses…'
  } else if (canLookup && lookupNote) {
    status = lookupNote
  } else if (canLookup) {
    status = 'Pick a suggestion to verify this address.'
  }

  return (
    <div className="address-autocomplete">
      <label className="address-field">
        Street address
        <input
          value={street}
          onChange={(event) => onStreetTyped(event.target.value)}
          onFocus={() => {
            window.clearTimeout(blurTimer.current)
            if (visibleSuggestions.length) setOpen(true)
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 150)
          }}
          placeholder={streetPlaceholder}
          maxLength={120}
          required
          autoComplete="off"
          role="combobox"
          aria-expanded={open && visibleSuggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          data-testid="address-street"
        />
      </label>
      {open && visibleSuggestions.length > 0 ? (
        <ul id={listId} className="address-suggestion-list" role="listbox" data-testid="address-suggestions">
          {visibleSuggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                type="button"
                className="address-suggestion"
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(suggestion)}
              >
                {suggestion.placeName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="address-field">
        City
        <input
          value={city}
          onChange={(event) => onCityTyped(event.target.value)}
          placeholder={cityPlaceholder}
          maxLength={120}
          required
          autoComplete="address-level2"
          disabled={disabled}
          data-testid="address-city"
        />
      </label>
      {status ? (
        <p
          className={
            verified ? 'hint address-verified-note' : 'hint address-verify-warning'
          }
          role="status"
          data-testid="address-status"
        >
          {status}
        </p>
      ) : null}
    </div>
  )
}

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CircleHelp, Map, MessageCircle, Package, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { UserButton } from '@clerk/react-router'
import { api } from '../api/client.ts'
import {
  isDemoStreetAddress,
  type VerifiedAddress,
} from '../data/addressVerify.ts'
import { placeLabel } from '../data/index.ts'
import { sphereClass, type SectionSphere } from '../data/sectionSpheres.ts'
import { useIsAdmin } from '../state/adminAccess.ts'
import { useCurrentResident } from '../state/currentResidentStore.ts'
import { AddressAutocomplete } from './AddressAutocomplete.tsx'
import { Atmosphere } from './Atmosphere.tsx'

/** Map stays the landing route (`/`) but sits in the center of the dock. */
const links: {
  to: string
  label: string
  icon: LucideIcon
  sphere: SectionSphere
  end?: boolean
}[] = [
  { to: '/chat', label: 'Chat', icon: MessageCircle, sphere: 'sky' },
  { to: '/my-stuff', label: 'My Inventory', icon: Package, sphere: 'mint' },
  { to: '/', label: 'Map', icon: Map, sphere: 'turquoise', end: true },
  { to: '/activity', label: 'Activity', icon: Bell, sphere: 'aqua' },
  { to: '/about', label: 'About', icon: CircleHelp, sphere: 'sky' },
]

export function AppLayout() {
  const resident = useCurrentResident()
  const label = placeLabel(resident.street, resident.city, Boolean(resident.id))
  const showVerifyBanner = Boolean(resident.id) && resident.onboarded && !resident.addressVerified

  const location = useLocation()
  const mapHome =
    location.pathname === '/' || location.pathname === '/neighborhood'

  return (
    <div className={['app-shell', mapHome ? 'app-shell-map' : ''].filter(Boolean).join(' ')}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <Atmosphere />
      <div className="app-frame">
        <aside className="sidebar shell-panel shell-aero-surface">
          <ShellAero idPrefix="sidebar" />
          <Wordmark />
          {label ? (
            <p className="sidebar-place-label" title={label}>
              {label}
            </p>
          ) : null}
          <PrimaryNav layout="side" />
          <div className="sidebar-foot">
            <ResidentCard />
          </div>
        </aside>
        <div className="app-main">
          <header className="mobile-chrome shell-panel shell-aero-surface">
            <ShellAero idPrefix="mobile-chrome" />
            <div className="mobile-bar">
              <Wordmark compact />
              <ResidentCard compact />
            </div>
            {label && !mapHome ? (
              <p className="mobile-place-label" title={label}>
                {label}
              </p>
            ) : null}
          </header>
          <PrimaryNav layout="dock" />
          {showVerifyBanner ? (
            <p className="hint address-verify-banner" role="status" data-testid="address-verify-banner">
              Verify your address to appear to neighbors
            </p>
          ) : null}
          <main id="content" className="page-canvas">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}

function ShellAero({ idPrefix }: { idPrefix: string }) {
  const beamId = `${idPrefix}-aero-beam`
  const beamSoftId = `${idPrefix}-aero-beam-soft`

  return (
    <div className="shell-aero" aria-hidden="true">
      <div className="shell-aero-sun" />
      <div className="shell-aero-beam shell-aero-beam-a" />
      <div className="shell-aero-beam shell-aero-beam-b" />
      <div className="shell-aero-beam shell-aero-beam-c" />
      <svg
        className="shell-aero-waves"
        viewBox="0 0 240 720"
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <linearGradient id={beamId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.62" />
            <stop offset="42%" stopColor="#c4f8dc" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#9ee58a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={beamSoftId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.42" />
            <stop offset="50%" stopColor="#c9fff8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#63e7a6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="shell-aero-ribbon shell-aero-ribbon-a"
          d="M48 -30 C 92 70, 18 150, 78 255 S 22 410, 96 515 S 34 640, 86 760 L 128 760 C 72 640, 150 515, 82 410 S 136 255, 58 150 S 118 70, 78 -30 Z"
          fill={`url(#${beamId})`}
        />
        <path
          className="shell-aero-ribbon shell-aero-ribbon-b"
          d="M132 -40 C 176 55, 108 145, 168 250 S 112 405, 186 510 S 124 635, 176 760 L 214 760 C 158 635, 236 510, 168 405 S 222 250, 148 145 S 202 55, 162 -40 Z"
          fill={`url(#${beamSoftId})`}
        />
        <path
          className="shell-aero-ribbon shell-aero-ribbon-c"
          d="M-8 -20 C 36 90, -28 175, 32 280 S -24 430, 48 540 S -12 655, 40 760 L 74 760 C 22 655, 96 540, 28 430 S 82 280, 8 175 S 62 90, 22 -20 Z"
          fill={`url(#${beamSoftId})`}
        />
      </svg>
    </div>
  )
}

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className={compact ? 'wordmark wordmark-compact' : 'wordmark'}>
      <span className="wordmark-copy">
        <span className="wordmark-name">Relay</span>
        {compact ? null : <span className="wordmark-tag">share nearby</span>}
      </span>
    </Link>
  )
}

function routeMatches(pathname: string, to: string, end?: boolean): boolean {
  if (to === '/') return pathname === '/' || pathname === '/neighborhood'
  if (end) return pathname === to
  return pathname === to || pathname.startsWith(`${to}/`)
}

function PrimaryNav({ layout }: { layout: 'side' | 'dock' }) {
  const isAdmin = useIsAdmin()
  const location = useLocation()
  const shown = isAdmin
    ? [...links, { to: '/admin', label: 'Admin', icon: ShieldCheck, sphere: 'sky' as SectionSphere, end: false }]
    : links
  const activeIndex = Math.max(
    0,
    shown.findIndex(({ to, end }) => routeMatches(location.pathname, to, end)),
  )
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useLayoutEffect(() => {
    if (layout !== 'dock' || !navRef.current) return
    const measure = () => {
      if (!navRef.current) return
      const pills = Array.from(navRef.current.querySelectorAll<HTMLElement>('.nav-pill'))
      const active = pills[activeIndex]
      if (!active) return
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth, ready: true })
    }
    measure()
    const frame = window.requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
    }
  }, [layout, activeIndex, shown.length, location.pathname])

  return (
    <nav
      ref={navRef}
      aria-label="Primary"
      className={
        layout === 'side' ? 'side-nav' : 'mobile-dock shell-panel shell-aero-surface'
      }
    >
      {layout === 'dock' ? <ShellAero idPrefix="mobile-dock" /> : null}
      {layout === 'dock' && indicator.ready ? (
        <span
          className="mobile-dock-indicator"
          aria-hidden="true"
          style={{
            transform: `translate3d(${indicator.left}px, 0, 0)`,
            width: `${indicator.width}px`,
          }}
        />
      ) : null}
      {shown.map(({ to, label, icon: Icon, sphere, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            [
              'nav-pill',
              sphereClass(sphere),
              layout === 'side' ? 'nav-pill-side' : '',
              isActive || (to === '/' && location.pathname === '/neighborhood') ? 'nav-pill-active' : '',
            ]
              .filter(Boolean)
              .join(' ')
          }
        >
          <span className="nav-pill-icon">
            <Icon aria-hidden="true" size={18} />
          </span>
          {layout === 'side' ? (
            label
          ) : (
            <span className="sr-only">{label}</span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function ResidentCard({ compact = false }: { compact?: boolean }) {
  const resident = useCurrentResident()
  const [editing, setEditing] = useState(false)

  return (
    <div className={compact ? 'resident resident-compact' : 'resident'}>
      <UserButton />
      <span className="resident-copy">
        <span className="resident-name" aria-hidden={compact ? true : undefined}>
          {compact ? resident.shortName : resident.name}
        </span>
        {compact ? <span className="sr-only">{resident.name}</span> : null}
        {resident.id ? (
          <button type="button" className="resident-edit" onClick={() => setEditing(true)}>
            Edit profile
          </button>
        ) : null}
      </span>
      {editing && resident.id
        ? createPortal(
            <EditProfileForm
              residentId={resident.id}
              street={resident.street}
              city={resident.city}
              about={resident.about}
              addressVerified={resident.addressVerified}
              formattedAddress={resident.formattedAddress}
              state={resident.state}
              latitude={resident.latitude}
              longitude={resident.longitude}
              onClose={() => setEditing(false)}
              onSaved={async () => {
                await resident.refreshProfile()
                setEditing(false)
              }}
            />,
            document.body,
          )
        : null}
    </div>
  )
}

function EditProfileForm({
  residentId,
  street,
  city,
  about,
  addressVerified,
  formattedAddress,
  state,
  latitude,
  longitude,
  onClose,
  onSaved,
}: {
  residentId: string
  street: string
  city: string
  about: string
  addressVerified: boolean
  formattedAddress: string
  state: string
  latitude: number | null
  longitude: number | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const titleId = useId()
  const [nextStreet, setNextStreet] = useState(street)
  const [nextCity, setNextCity] = useState(city)
  const [nextAbout, setNextAbout] = useState(about)
  const [verified, setVerified] = useState<VerifiedAddress | null>(() =>
    addressVerified && latitude != null && longitude != null
      ? {
          street,
          city,
          state,
          formattedAddress: formattedAddress || `${street}, ${city}`,
          latitude,
          longitude,
        }
      : null,
  )
  const [geocoderDown, setGeocoderDown] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!nextStreet.trim()) {
      setError('Enter your street address.')
      return
    }
    if (!nextCity.trim()) {
      setError('Enter your city.')
      return
    }
    if (isDemoStreetAddress(nextStreet)) {
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
      await api.updateProfile({
        clerk_user_id: residentId,
        street: verified?.street ?? nextStreet.trim(),
        city: verified?.city ?? nextCity.trim(),
        about: nextAbout.trim(),
        latitude: verified?.latitude ?? null,
        longitude: verified?.longitude ?? null,
        formatted_address: verified?.formattedAddress ?? null,
        state: verified?.state ?? null,
      })
      await onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="profile-edit-backdrop" role="presentation" onClick={onClose}>
      <form
        className="profile-edit-card"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2 id={titleId}>Edit profile</h2>
        <p className="profile-edit-lead">
          Pick a verified street suggestion so neighbors can find you on the map. Change email or
          password from the avatar menu (Clerk).
        </p>
        <AddressAutocomplete
          street={nextStreet}
          city={nextCity}
          verified={verified}
          onStreetChange={setNextStreet}
          onCityChange={setNextCity}
          onVerifiedChange={setVerified}
          onGeocoderUnavailable={() => setGeocoderDown(true)}
          disabled={busy}
        />
        <label>
          About you
          <textarea
            value={nextAbout}
            onChange={(event) => setNextAbout(event.target.value)}
            rows={3}
            placeholder="I lend tools on weekends."
          />
        </label>
        {error ? <p className="profile-edit-error">{error}</p> : null}
        <div className="profile-edit-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

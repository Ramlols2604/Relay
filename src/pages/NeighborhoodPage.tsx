import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Map, X } from 'lucide-react'
import { GlassCard } from '../components/GlassCard.tsx'
import { demoResident } from '../data/index.ts'
import { addressQuery, geocodeAddress, mapboxAccessToken, type MapCenter } from '../data/geocode.ts'
import { useCurrentResident } from '../state/currentResidentStore.ts'
import {
  demoMapBackdrop,
  linksForResident,
  residentsFromListings,
  shareLinksBetween,
  type SceneResident,
} from '../data/neighborhood.ts'
import { givenName, loanStatusCopy, type LoanRequest } from '../data/lending.ts'
import { useLoanRequests } from '../state/loanStore.ts'
import { useShelfResident } from '../state/shelfResidentStore.ts'
import { api } from '../api/client.ts'
import type { ApiInventoryItem } from '../api/types.ts'
import {
  DEFAULT_RADIUS_MILES,
  nextWiderRadius,
  RADIUS_STEPS,
  RADIUS_WIDEN_THRESHOLD,
  radiusLabel,
  readStoredRadius,
  type RadiusMiles,
  writeStoredRadius,
} from '../data/searchRadius.ts'
import {
  readSampleListingsPreference,
  resolveSampleListingsOn,
  writeSampleListingsPreference,
} from '../data/sampleListings.ts'

const RelayWorld = lazy(() => import('../components/RelayWorld.tsx').then((module) => ({ default: module.RelayWorld })))
const NeighborhoodMap = lazy(() =>
  import('../components/NeighborhoodMap.tsx').then((module) => ({ default: module.NeighborhoodMap })),
)

type MapFilter = 'all' | 'lending' | 'loans'
type HoodView = 'map' | '3d'

export function NeighborhoodPage() {
  const headingId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const { requests: loans } = useLoanRequests()
  const shelfId = useShelfResident()
  const you = useCurrentResident()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectParam = searchParams.get('select')
  const [appliedSelectParam, setAppliedSelectParam] = useState<string | null>(null)
  const cityName = you.city.trim()
  const [liveItems, setLiveItems] = useState<ApiInventoryItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [filter, setFilter] = useState<MapFilter>('all')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<HoodView>('map')
  const sampleUserId = shelfId || you.id || 'anon'
  const [sampleOwner, setSampleOwner] = useState(sampleUserId)
  const [showSampleListings, setShowSampleListings] = useState<boolean | null>(() =>
    readSampleListingsPreference(sampleUserId),
  )
  const radiusUserId = shelfId || you.id || 'anon'
  const [radiusMiles, setRadiusMiles] = useState<RadiusMiles>(() => readStoredRadius(radiusUserId))
  const [radiusOwner, setRadiusOwner] = useState(radiusUserId)
  const [sampleCount, setSampleCount] = useState(0)
  const [sampleError, setSampleError] = useState('')
  const [sheetExpanded, setSheetExpanded] = useState(true)
  const sheetDragRef = useRef<{ pointerId: number; startY: number; opened: boolean } | null>(null)
  const [geo, setGeo] = useState<{ query: string; center: MapCenter | null; failed: boolean }>({
    query: '',
    center: null,
    failed: false,
  })
  const mapToken = mapboxAccessToken()
  const placeQuery = addressQuery(you.street, you.city)

  function onSheetPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    sheetDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      opened: sheetExpanded,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onSheetPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = sheetDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientY - drag.startY
    sheetDragRef.current = null
    if (Math.abs(delta) < 24) {
      setSheetExpanded((open) => !open)
      return
    }
    setSheetExpanded(delta < 0)
  }

  // Re-hydrate slider + demo preference when the signed-in user changes (no effect setState).
  if (radiusOwner !== radiusUserId) {
    setRadiusOwner(radiusUserId)
    setRadiusMiles(readStoredRadius(radiusUserId))
  }
  if (sampleOwner !== sampleUserId) {
    setSampleOwner(sampleUserId)
    setShowSampleListings(readSampleListingsPreference(sampleUserId))
  }

  function chooseRadius(miles: RadiusMiles) {
    setRadiusMiles(miles)
    writeStoredRadius(radiusUserId, miles)
  }

  useEffect(() => {
    let cancel = false
    api
      .neighborhood(shelfId)
      .then((body) => {
        if (!cancel) setLiveItems(body.items)
      })
      .catch(() => {
        if (!cancel) setLiveItems([])
      })
    return () => {
      cancel = true
    }
  }, [shelfId])

  const verifiedCenter = useMemo((): MapCenter | null => {
    if (
      !you.addressVerified ||
      typeof you.latitude !== 'number' ||
      typeof you.longitude !== 'number' ||
      (you.latitude === 0 && you.longitude === 0)
    ) {
      return null
    }
    return {
      longitude: you.longitude,
      latitude: you.latitude,
      label: you.formattedAddress || placeQuery,
    }
  }, [placeQuery, you.addressVerified, you.formattedAddress, you.latitude, you.longitude])

  useEffect(() => {
    let cancel = false
    if (!placeQuery || verifiedCenter) return
    void geocodeAddress(you.street, you.city)
      .then((center) => {
        if (cancel) return
        setGeo({ query: placeQuery, center, failed: !center })
      })
      .catch(() => {
        if (cancel) return
        setGeo({ query: placeQuery, center: null, failed: true })
      })
    return () => {
      cancel = true
    }
  }, [placeQuery, verifiedCenter, you.city, you.street])

  const geocoded = verifiedCenter ?? (geo.query === placeQuery ? geo.center : null)
  const geocodeFailed = !verifiedCenter && geo.query === placeQuery ? geo.failed : false
  const mapOrigin = useMemo(
    () =>
      geocoded ?? {
        longitude: demoMapBackdrop.longitude,
        latitude: demoMapBackdrop.latitude,
      },
    [geocoded],
  )
  const searchCenter = useMemo(() => {
    if (
      you.addressVerified &&
      typeof you.latitude === 'number' &&
      typeof you.longitude === 'number' &&
      !(you.latitude === 0 && you.longitude === 0)
    ) {
      return { latitude: you.latitude, longitude: you.longitude }
    }
    if (geocoded) return { latitude: geocoded.latitude, longitude: geocoded.longitude }
    return { latitude: mapOrigin.latitude, longitude: mapOrigin.longitude }
  }, [geocoded, mapOrigin.latitude, mapOrigin.longitude, you.addressVerified, you.latitude, you.longitude])
  const usingDemoBackdrop = !geocoded
  const mapLabel = geocoded?.label ?? demoMapBackdrop.name
  const tokenMissingMessage = !mapToken
    ? 'Add VITE_MAPBOX_ACCESS_TOKEN to .env.local and restart Relay. The Map view needs it for the basemap.'
    : null

  const cityMatches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return liveItems.filter((item) => {
      if (!needle) return true
      return [item.resident_name, item.catalog_name, item.catalog_item, item.city]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [liveItems, query])

  const people = useMemo(
    () =>
      residentsFromListings(
        {
          id: shelfId,
          name: you.name || 'You',
          initials: you.initials || 'YO',
          street: you.street,
        },
        liveItems,
        mapOrigin,
      ),
    [liveItems, mapOrigin, shelfId, you.initials, you.name, you.street],
  )
  // `?select=<id>` (e.g. from a chat card's "Open on map") selects that resident once they load.
  // Adjusting state during render (not an effect) avoids a cascading-render setState warning.
  if (selectParam && selectParam !== appliedSelectParam && people.some((resident) => resident.id === selectParam)) {
    setAppliedSelectParam(selectParam)
    setSelectedLinkId(null)
    setSelectedId(selectParam)
  }

  // Clear the query param once the selection above has been applied.
  useEffect(() => {
    if (appliedSelectParam === null) return
    const next = new URLSearchParams(searchParams)
    next.delete('select')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSelectParam])

  const links = useMemo(() => shareLinksBetween(loans, shelfId), [loans, shelfId])
  const lendingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const resident of people) {
      if ((resident.offers?.length ?? 0) > 0) ids.add(resident.id)
    }
    return ids
  }, [people])

  const visibleResidents = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return people.filter((resident) => {
      if (filter === 'lending' && !lendingIds.has(resident.id)) return false
      if (filter === 'loans') {
        const onLoan = links.some(
          (link) => link.active && (link.fromId === resident.id || link.toId === resident.id),
        )
        if (!onLoan) return false
      }
      if (!needle) return true
      const haystack = [resident.name, resident.street, ...(resident.offers ?? [])].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [filter, lendingIds, links, people, query])

  const visibleIds = useMemo(
    () => new Set(visibleResidents.map((resident) => resident.id)),
    [visibleResidents],
  )
  const visibleLinks = useMemo(
    () => links.filter((link) => visibleIds.has(link.fromId) && visibleIds.has(link.toId)),
    [links, visibleIds],
  )
  const activeResidentId =
    selectedId && visibleIds.has(selectedId) ? selectedId : null
  const activeLinkId =
    selectedLinkId && visibleLinks.some((link) => link.id === selectedLinkId) ? selectedLinkId : null

  const selected = activeResidentId ? people.find((resident) => resident.id === activeResidentId) ?? null : null
  const selectedItems = useMemo(() => {
    if (!selected) return []
    return (selected.offers ?? []).map((name) => ({ id: name, name, detail: 'Ready to lend' }))
  }, [selected])
  const selectedLoan = activeLinkId ? (loans.find((loan) => loan.id === activeLinkId) ?? null) : null
  const activeLinks = links.filter((link) => link.active)
  const pendingLinks = links.filter((link) => !link.active)

  useEffect(() => {
    if (!activeResidentId && !activeLinkId) return
    if (window.matchMedia('(min-width: 52rem)').matches) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [activeResidentId, activeLinkId])

  function selectResident(id: string) {
    if (!people.some((resident) => resident.id === id)) return
    setSelectedLinkId(null)
    setSelectedId(id)
  }

  function selectLink(id: string) {
    setSelectedId(null)
    setSelectedLinkId(id)
  }

  const lendingCount = people.filter((resident) => lendingIds.has(resident.id)).length
  const hasRealNeighbors = people.some((resident) => !resident.isYou)
  // Auto-on only when nobody real is nearby; an explicit toggle still wins.
  const sampleListingsOn = resolveSampleListingsOn(showSampleListings, hasRealNeighbors)
  const widerRadius = nextWiderRadius(radiusMiles)
  const widenPrompt =
    sampleListingsOn && sampleCount < RADIUS_WIDEN_THRESHOLD && widerRadius != null

  // Keep a sample count even when the Map GL view is not mounted (e.g. 3D tab).
  useEffect(() => {
    if (!sampleListingsOn || !searchCenter) {
      if (!sampleListingsOn) {
        setSampleCount(0)
        setSampleError('')
      }
      return
    }
    let cancel = false
    const timer = window.setTimeout(() => {
      void api
        .listings(
          {
            radiusMiles,
            latitude: searchCenter.latitude,
            longitude: searchCenter.longitude,
          },
          2000,
        )
        .then((body) => {
          if (cancel) return
          setSampleCount(body.count)
          setSampleError('')
        })
        .catch((error) => {
          if (cancel) return
          setSampleCount(0)
          setSampleError(error instanceof Error ? error.message : 'Could not load demo listings.')
        })
    }, 250)
    return () => {
      cancel = true
      window.clearTimeout(timer)
    }
  }, [sampleListingsOn, radiusMiles, searchCenter])

  const emptyMessage =
    query.trim() && visibleResidents.length === 0
      ? `No people, products, or inventory match “${query.trim()}”.`
      : filter === 'loans' && visibleResidents.length === 0
      ? 'No active loans right now.'
      : filter === 'lending' && visibleResidents.length === 0
        ? 'Nobody has something listed to lend.'
        : !hasRealNeighbors && cityMatches.length === 0
          ? `Nobody else in ${cityName || 'your city'} has listed inventory yet. Sample pins are map-only and are not real neighbors.`
          : null

  return (
    <section
      className={['hood-page', sheetExpanded ? 'hood-page-sheet-open' : ''].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <div className="hood-map-stage">
        <div className="hood-view-switch hood-view-switch-floating" role="group" aria-label="Neighborhood view">
          {(['map', '3d'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={view === id ? 'admin-tab admin-tab-active' : 'admin-tab'}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {id === 'map' ? 'Map' : '3D world'}
            </button>
          ))}
        </div>
        {tokenMissingMessage ? (
          <p className="hood-map-token-warning hood-map-token-warning-floating" role="status">
            {tokenMissingMessage}
          </p>
        ) : null}
        {geocodeFailed && mapToken ? (
          <p className="hint hood-map-backdrop-note hood-map-token-warning-floating" role="status">
            Could not locate that address on the map. Showing the demo backdrop until geocoding works.
          </p>
        ) : null}
        {view === '3d' ? (
          <Suspense fallback={<p className="hint">Building the neighborhood…</p>}>
            <RelayWorld
              radiusMiles={radiusMiles}
              // Only filter by miles once we have a real geocoded/verified center.
              // Passing the demo backdrop first would rebuild the town when the address resolves.
              searchCenter={geocoded ? searchCenter : null}
            />
          </Suspense>
        ) : (
          <div className="hood-layout hood-layout-map-first">
            <div className="hood-map-column">
              <Suspense fallback={<p className="hint">Loading map…</p>}>
                <NeighborhoodMap
                  key={`${mapOrigin.longitude.toFixed(5)},${mapOrigin.latitude.toFixed(5)}`}
                  residents={visibleResidents}
                  links={visibleLinks}
                  lendingIds={lendingIds}
                  selectedId={activeResidentId}
                  selectedLinkId={activeLinkId}
                  onSelectResident={selectResident}
                  onSelectLink={selectLink}
                  emptyMessage={emptyMessage}
                  mapOrigin={mapOrigin}
                  mapLabel={mapLabel}
                  usingDemoBackdrop={usingDemoBackdrop}
                  tokenMissingMessage={tokenMissingMessage}
                  showSampleListings={sampleListingsOn}
                  radiusMiles={radiusMiles}
                  searchCenter={searchCenter}
                  onSampleCountChange={setSampleCount}
                />
              </Suspense>
            </div>
            {selectedLoan || selected ? (
              <aside className="hood-panel" ref={panelRef} aria-live="polite">
                {selectedLoan ? (
                  <LoanCard
                    loan={selectedLoan}
                    people={people}
                    youId={shelfId}
                    onClose={() => setSelectedLinkId(null)}
                    onSelectResident={selectResident}
                  />
                ) : selected ? (
                  <ResidentCard
                    resident={selected}
                    items={selectedItems}
                    loans={loans}
                    links={linksForResident(selected.id, links)}
                    onClose={() => setSelectedId(null)}
                    onSelectLink={selectLink}
                    onAskInChat={
                      selected.isYou
                        ? undefined
                        : (itemName) =>
                            void navigate(
                              `/chat?draft=${encodeURIComponent(
                                `I'd like to borrow ${itemName} from ${selected.name}`,
                              )}`,
                            )
                    }
                  />
                ) : null}
              </aside>
            ) : (
              <aside className="hood-panel hood-panel-desktop-idle" aria-live="polite">
                <div className="hood-panel-idle">
                  <p className="hood-panel-kicker">On this map</p>
                  <p className="hood-idle-copy">
                    Tap a resident or demo pin to see what they can lend.
                  </p>
                </div>
              </aside>
            )}
          </div>
        )}
      </div>

      <GlassCard
        tone="solid"
        className={['hood-sheet', sheetExpanded ? 'hood-sheet-expanded' : ''].filter(Boolean).join(' ')}
      >
        <div
          className="hood-sheet-handle"
          role="button"
          tabIndex={0}
          aria-expanded={sheetExpanded}
          aria-controls="hood-sheet-body"
          aria-label={sheetExpanded ? 'Collapse map controls' : 'Expand map controls'}
          onPointerDown={onSheetPointerDown}
          onPointerUp={onSheetPointerUp}
          onPointerCancel={onSheetPointerUp}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setSheetExpanded((open) => !open)
            }
          }}
        >
          <span className="hood-sheet-grip" aria-hidden="true" />
          <div className="hood-sheet-summary">
            <span className="icon-chip sphere-turquoise hood-sheet-icon">
              <Map aria-hidden="true" size={18} />
            </span>
            <div className="hood-sheet-copy">
              <p className="eyebrow">Around the block</p>
              <h1 id={headingId} className="hood-title hood-title-compact">
                Neighborhood
              </h1>
              <p className="hood-listings-note">
                {cityMatches.length} neighbor listing{cityMatches.length === 1 ? '' : 's'} ·{' '}
                {sampleListingsOn ? `${sampleCount} samples` : 'samples off'} · {radiusLabel(radiusMiles)}
              </p>
            </div>
          </div>
        </div>

        <div id="hood-sheet-body" className="hood-sheet-body" hidden={!sheetExpanded}>
          <div className="hood-search">
            <input
              type="search"
              value={query}
              aria-label="Search people, products, and inventory"
              placeholder="Search your city"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="hood-filters" role="group" aria-label="Show residents">
            <FilterButton
              pressed={filter === 'all'}
              count={people.length}
              onClick={() => setFilter('all')}
            >
              All
            </FilterButton>
            <FilterButton
              pressed={filter === 'lending'}
              count={lendingCount}
              onClick={() => setFilter('lending')}
            >
              Lending
            </FilterButton>
            <FilterButton
              pressed={filter === 'loans'}
              count={activeLinks.length}
              onClick={() => setFilter('loans')}
            >
              Active loans
            </FilterButton>
          </div>
          <label className="hood-sample-toggle">
            <input
              type="checkbox"
              checked={sampleListingsOn}
              onChange={(event) => {
                const on = event.target.checked
                setShowSampleListings(on)
                writeSampleListingsPreference(sampleUserId, on)
              }}
            />
            Show demo listings
            {showSampleListings === null ? (
              <span className="hood-sample-auto-hint">
                {hasRealNeighbors ? ' (off while neighbors are nearby)' : ' (on while you are alone)'}
              </span>
            ) : null}
          </label>
          {sampleError ? (
            <p className="hood-map-token-warning" role="status">
              Demo listings failed to load: {sampleError}
            </p>
          ) : null}
          <div className="hood-radius" data-testid="search-radius">
            <label className="hood-radius-label" htmlFor="hood-radius-slider">
              {radiusLabel(radiusMiles)}
            </label>
            <input
              id="hood-radius-slider"
              type="range"
              min={0}
              max={RADIUS_STEPS.length - 1}
              step={1}
              value={RADIUS_STEPS.indexOf(radiusMiles)}
              aria-valuetext={radiusLabel(radiusMiles)}
              onChange={(event) => {
                const step = RADIUS_STEPS[Number(event.target.value)] ?? DEFAULT_RADIUS_MILES
                chooseRadius(step)
              }}
              data-testid="search-radius-slider"
            />
            <div className="hood-radius-ticks" aria-hidden="true">
              {RADIUS_STEPS.map((step) => (
                <span key={step}>{step}</span>
              ))}
            </div>
          </div>
          {widenPrompt && widerRadius ? (
            <p className="hood-widen" role="status" data-testid="search-radius-widen">
              Only {sampleCount} listing{sampleCount === 1 ? '' : 's'} within {radiusMiles} miles.
              Widen the search?{' '}
              <button
                type="button"
                className="hood-widen-button"
                onClick={() => chooseRadius(widerRadius)}
              >
                Try {widerRadius} miles
              </button>
            </p>
          ) : null}
          <div className="hood-legend" aria-label="Map legend">
            <span className="hood-legend-item">
              <span className="hood-legend-swatch hood-legend-lending" aria-hidden="true" />
              Has something to lend
            </span>
            <span className="hood-legend-item">
              <span className="hood-legend-swatch hood-legend-link" aria-hidden="true" />
              Active loan ({activeLinks.length})
            </span>
            <span className="hood-legend-item">
              <span className="hood-legend-swatch hood-legend-pending" aria-hidden="true" />
              Requested ({pendingLinks.length})
            </span>
            {sampleListingsOn ? (
              <span className="hood-legend-item">
                <span className="hood-legend-swatch hood-legend-sample" aria-hidden="true" />
                Demo listing
              </span>
            ) : null}
          </div>
          {links.length > 0 ? (
            <div className="hood-share-note hood-share-note-inline">
              <p className="hood-share-title">Loans</p>
              <ul className="hood-share-list">
                {links.map((link) => {
                  const loan = loans.find((item) => item.id === link.id)
                  if (!loan) return null
                  const lender = givenName(loan.lenderName)
                  const borrower = givenName(loan.borrowerName ?? demoResident.name)
                  return (
                    <li key={link.id}>
                      <button
                        type="button"
                        className={[
                          'hood-share-button',
                          activeLinkId === link.id ? 'hood-share-button-selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => selectLink(link.id)}
                      >
                        <span className="hood-item-name">{link.itemName}</span>
                        <span className="hood-item-detail">
                          {lender} to {borrower} · {link.status}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </GlassCard>
    </section>
  )
}

function FilterButton({
  pressed,
  count,
  onClick,
  children,
}: {
  pressed: boolean
  count: number
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      className={['hood-filter', pressed ? 'hood-filter-active' : ''].filter(Boolean).join(' ')}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
      <span className="hood-filter-count">{count}</span>
    </button>
  )
}

function ResidentCard({
  resident,
  items,
  loans,
  links,
  onClose,
  onSelectLink,
  onAskInChat,
}: {
  resident: SceneResident
  items: readonly { id: string; name: string; detail: string }[]
  loans: readonly LoanRequest[]
  links: readonly { id: string; itemName: string; status: string }[]
  onClose: () => void
  onSelectLink: (id: string) => void
  onAskInChat?: (itemName: string) => void
}) {
  const firstItem = items[0]?.name

  return (
    <>
      <div className="hood-panel-head">
        <div className="hood-panel-who">
          <span className="hood-panel-avatar" aria-hidden="true">
            {resident.initials}
          </span>
          <div className="grid gap-0.5">
            <p className="hood-panel-name">
              {resident.name}
              {resident.isYou ? ' · you' : ''}
            </p>
            {resident.street ? <p className="hint">{resident.street}</p> : null}
          </div>
        </div>
        <button type="button" className="hood-panel-close" aria-label="Close resident panel" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <p className="hood-panel-kicker">Available to lend</p>
      {items.length > 0 ? (
        <ul className="hood-item-list">
          {items.map((item) => (
            <li key={item.id} className="hood-item">
              <span className="hood-item-name">{item.name}</span>
              <span className="hood-item-detail">{item.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing listed to lend right now.</p>
      )}
      {onAskInChat && firstItem ? (
        <button type="button" className="loan-back" onClick={() => onAskInChat(firstItem)}>
          Ask in chat
        </button>
      ) : null}
      {links.length > 0 ? (
        <>
          <p className="hood-panel-kicker">Loans</p>
          <ul className="hood-item-list">
            {links.map((link) => {
              const loan = loans.find((item) => item.id === link.id)
              return (
                <li key={link.id}>
                  <button type="button" className="hood-loan" onClick={() => onSelectLink(link.id)}>
                    <span className="hood-item-name">{link.itemName}</span>
                    <span className="hood-item-detail">{loan?.status ?? link.status}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </>
  )
}

function LoanCard({
  loan,
  people,
  youId,
  onClose,
  onSelectResident,
}: {
  loan: LoanRequest
  people: readonly SceneResident[]
  youId: string
  onClose: () => void
  onSelectResident: (id: string) => void
}) {
  const party = (id: string | undefined) => {
    if (!id) return null
    const resolved = id === 'resident-avery' ? youId : id
    return people.find((resident) => resident.id === resolved) ?? null
  }
  const lender = party(loan.lenderId)
  const borrower = party(loan.borrowerId)
  const active = loan.status !== 'Requested' && loan.status !== 'Returned'

  return (
    <>
      <div className="hood-panel-head">
        <div className="grid gap-0.5">
          <p className={active ? 'hood-panel-kicker hood-kicker-active' : 'hood-panel-kicker'}>{loan.status}</p>
          <p className="hood-panel-name">{loan.itemName}</p>
        </div>
        <button type="button" className="hood-panel-close" aria-label="Close loan panel" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      <p className="hood-loan-parties">
        {givenName(loan.lenderName)} lending to {givenName(loan.borrowerName ?? demoResident.name)}
      </p>
      <p className="hood-loan-copy">{loanStatusCopy(loan)}</p>
      <div className="hood-party-row">
        {lender ? (
          <button type="button" className="hood-party" onClick={() => onSelectResident(lender.id)}>
            {lender.isYou ? 'You' : givenName(lender.name)}
            <span>Lender</span>
          </button>
        ) : null}
        {borrower ? (
          <button type="button" className="hood-party" onClick={() => onSelectResident(borrower.id)}>
            {borrower.isYou ? 'You' : givenName(borrower.name)}
            <span>Borrower</span>
          </button>
        ) : null}
      </div>
    </>
  )
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Moon, Search, Sun } from 'lucide-react'
import { StatusTimeline } from './StatusTimeline.tsx'
import { useActivityFeed } from '../state/activityFeedStore.ts'
import { useCurrentResident } from '../state/currentResidentStore.ts'
import { useShelfResident } from '../state/shelfResidentStore.ts'
import { kpisFrom, loanSteps, rememberStatuses, sceneFrom, tripsForChanges, type StatusMemory } from '../world/activity.ts'
import { demoPreviewResidents, worldEmptyCopy } from '../world/demoNeighbors.ts'
import { describe } from '../world/describe.ts'
import { haversineMiles, type RadiusMiles } from '../data/searchRadius.ts'
import { layoutLots, zonesOf } from '../world/layout.ts'
import { RelayScene } from '../world/scene.ts'
import { useWorldData } from '../world/useWorldData.ts'

type TableTab = 'loans' | 'neighbors' | 'groupbuys'

type RelayWorldProps = {
  radiusMiles?: RadiusMiles
  searchCenter?: { latitude: number; longitude: number } | null
}

declare global {
  interface Window {
    __RELAY_E2E__?: boolean
    __relayWorld?: RelayScene
  }
}

/** A live 3D town of the neighborhood: houses, walkers carrying loans, and what needs attention. */
export function RelayWorld({ radiusMiles = 2, searchCenter = null }: RelayWorldProps) {
  const headingId = useId()
  const viewer = useShelfResident()
  const you = useCurrentResident()
  const { activity, error: feedError } = useActivityFeed()
  const data = useWorldData()

  const labelRef = useRef<HTMLDivElement>(null)
  const townKey = useRef('')
  const memory = useRef<StatusMemory>({})
  const [ready, setReady] = useState<RelayScene | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [night, setNight] = useState(false)
  const [tab, setTab] = useState<TableTab>('loans')
  const [query, setQuery] = useState('')
  const [clock, setClock] = useState(() => new Date())
  const [previewDemo, setPreviewDemo] = useState(false)

  // Everyone with a loan or handoff in progress gets a house, however far away they are.
  const involved = useMemo(() => {
    const ids = new Set<string>()
    for (const loan of activity?.loans ?? []) {
      ids.add(loan.lender_id)
      ids.add(loan.borrower_id)
    }
    for (const handoff of activity?.handoffs ?? []) {
      ids.add(handoff.recipient_id)
      for (const allocation of handoff.allocations) ids.add(allocation.resident_id)
    }
    for (const buy of data.groupBuys) for (const member of buy.members) ids.add(member.resident_id)
    return ids
  }, [activity, data.groupBuys])
  // Wait for neighbors, activity, and the first tallies pass before laying out the town.
  // Tallies (garden + group buys) used to arrive a beat later and rebuild the mesh under an
  // already-measured click target — that is the flaky 3D house click.
  const loaded =
    data.peopleReady &&
    data.talliesReady &&
    (activity !== null || feedError !== null)
  const cityLabel = you.city.trim() || data.residents.find((row) => row.id === viewer)?.city.trim() || ''
  const residentsForTown = useMemo(() => {
    const base = (() => {
      if (!previewDemo) return data.residents
      const extras = demoPreviewResidents(viewer, cityLabel || 'your city')
      const seen = new Set(data.residents.map((row) => row.id))
      return [...data.residents, ...extras.filter((row) => !seen.has(row.id))]
    })()
    if (!searchCenter) return base
    return base.filter((resident) => {
      if (resident.id === viewer || involved.has(resident.id)) return true
      const lat = resident.latitude
      const lng = resident.longitude
      if (typeof lat !== 'number' || typeof lng !== 'number') return true
      return haversineMiles(searchCenter.latitude, searchCenter.longitude, lat, lng) <= radiusMiles
    })
  }, [cityLabel, data.residents, involved, previewDemo, radiusMiles, searchCenter, viewer])
  const lots = useMemo(
    () => (loaded ? layoutLots(residentsForTown, viewer, 36, involved) : []),
    [loaded, residentsForTown, viewer, involved],
  )
  const neighborLots = useMemo(() => lots.filter((lot) => lot.id !== viewer), [lots, viewer])
  const aloneInCity = loaded && !previewDemo && neighborLots.length === 0
  const housed = useMemo(() => new Set(lots.map((lot) => lot.id)), [lots])
  const residentMap = useMemo(
    () => new Map(residentsForTown.map((resident) => [resident.id, resident])),
    [residentsForTown],
  )
  const zones = useMemo(() => zonesOf(lots), [lots])
  const scene = useMemo(() => sceneFrom(activity, housed, data.names), [activity, housed, data.names])
  const kpis = kpisFrom(activity, data.garden, lots.length)

  // Create the renderer when the canvas host mounts and destroy it when it unmounts.
  const attach = useCallback((host: HTMLDivElement | null) => {
    if (!host) return
    let created: RelayScene
    try {
      created = new RelayScene(host, {
        onPick: (hit) => setSelected((current) => (hit && hit.id !== current ? hit.id : null)),
        onLabel: (at) => {
          const label = labelRef.current
          if (!label) return
          label.style.display = at ? 'block' : 'none'
          if (at) label.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -140%)`
        },
      })
    } catch {
      setUnsupported(true)
      return
    }
    setReady(created)
    if (window.__RELAY_E2E__) window.__relayWorld = created
    return () => {
      created.dispose()
      setReady(null)
      if (window.__relayWorld === created) delete window.__relayWorld
    }
  }, [])

  // Keep the town, the beacons and the walkers in step with the data.
  // Town geometry key is only house ids + cells + viewer — never garden tallies or listing
  // counts. Garden flowers update in place so a later tally poll cannot shift click targets.
  useEffect(() => {
    if (!ready) return
    const key = JSON.stringify([lots.map((lot) => [lot.id, lot.col, lot.row]), viewer])
    if (key !== townKey.current) {
      ready.setTown(lots, viewer, data.garden)
      townKey.current = key
    } else {
      ready.setGarden(data.garden)
    }
    ready.setBeacons(scene.beacons)
    ready.setRepeatingTrips(scene.trips)
    ready.setGroupBuys(data.groupBuys.map((buy) => ({ id: buy.catalog_item_id, members: buy.members.length })))
  }, [ready, lots, viewer, data.garden, data.groupBuys, scene])

  // A status change plays one trip. The first look at the data plays none.
  useEffect(() => {
    if (!ready || !activity) return
    ready.playTrips(tripsForChanges(memory.current, activity, housed, data.names))
    memory.current = rememberStatuses(activity)
  }, [ready, activity, housed, data.names])

  useEffect(() => {
    ready?.setNight(night)
  }, [ready, night])

  useEffect(() => {
    ready?.select(selected)
  }, [ready, selected])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const tripSubjects = useMemo(() => new Map(scene.trips.map((trip) => [trip.id, trip.subjectId])), [scene.trips])
  const detail = describe(selected, {
    residents: residentMap,
    activity,
    names: data.names,
    groupBuys: data.groupBuys,
    finished: data.garden,
    tripSubjects,
  })

  const needle = query.trim().toLowerCase()
  const matches = needle
    ? [
        ...lots.filter((lot) => `${lot.resident.name} ${lot.resident.street}`.toLowerCase().includes(needle)).map((lot) => ({ id: `h:${lot.id}`, text: lot.resident.name })),
        ...(activity?.loans ?? [])
          .filter((loan) => (data.names.get(loan.catalog_item_id) ?? loan.catalog_item_id).toLowerCase().includes(needle))
          .map((loan) => ({ id: `s:${loan.loan_id}`, text: `${data.names.get(loan.catalog_item_id) ?? loan.catalog_item_id} · ${loan.status.replace('_', ' ')}` })),
      ].slice(0, 6)
    : []

  const loans = activity?.loans ?? []
  const nameOf = (id: string) => residentMap.get(id)?.name ?? id

  if (unsupported) {
    return (
      <section className="world world-fallback" aria-labelledby={headingId}>
        <h2 id={headingId} className="match-title">
          3D view unavailable
        </h2>
        <p className="hint">This browser could not start WebGL. The map view still works.</p>
      </section>
    )
  }

  return (
    <section className={night ? 'world world-night' : 'world'} aria-labelledby={headingId}>
      <header className="world-bar">
        <h2 id={headingId} className="world-logo">
          Relay World
        </h2>
        <label className="world-search">
          <Search aria-hidden="true" size={16} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a neighbor or an item" aria-label="Search the neighborhood" />
          {matches.length > 0 ? (
            <ul className="world-results" role="listbox">
              {matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(match.id)
                      setQuery('')
                    }}
                  >
                    {match.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </label>
        <label className="world-zone">
          <span className="sr-only">Area</span>
          <select
            defaultValue=""
            onChange={(event) => {
              const zone = zones.find((row) => row.name === event.target.value)
              if (zone) ready?.flyTo(zone.x, zone.z, 1.35)
              if (event.target.value === '__hub') ready?.select('hub')
            }}
            aria-label="Fly to an area"
          >
            <option value="" disabled>
              Fly to…
            </option>
            <option value="__hub">Relay Hub</option>
            {zones.map((zone) => (
              <option key={zone.name} value={zone.name}>
                {zone.name} ({zone.count})
              </option>
            ))}
          </select>
        </label>
        <time className="world-clock" dateTime={clock.toISOString()}>
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </time>
        <button type="button" className="world-toggle" aria-pressed={night} onClick={() => setNight((value) => !value)}>
          {night ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
          <span>{night ? 'Day' : 'Night'}</span>
        </button>
      </header>

      <div className="world-stage">
        <div ref={attach} className="world-canvas" data-testid="world-canvas" />
        <div ref={labelRef} className="world-label" style={{ display: 'none' }}>
          {detail?.title ?? ''}
        </div>
        <ul className="world-kpis" aria-label="Neighborhood totals">
          <li>
            <span className="world-kpi-value">{kpis.activeLoans}</span>
            <span className="world-kpi-label">Active loans</span>
          </li>
          <li className={kpis.overdue > 0 ? 'world-kpi-alert' : undefined}>
            <span className="world-kpi-value">{kpis.overdue}</span>
            <span className="world-kpi-label">Overdue</span>
          </li>
          <li>
            <span className="world-kpi-value">{kpis.finished}</span>
            <span className="world-kpi-label">Exchanges finished</span>
          </li>
        </ul>
        {aloneInCity ? (
          <div className="world-empty" role="status" data-testid="world-empty">
            <p className="world-empty-copy">{worldEmptyCopy(cityLabel)}</p>
            <button type="button" className="world-empty-action" onClick={() => setPreviewDemo(true)}>
              Preview with demo neighbors
            </button>
          </div>
        ) : null}
        {previewDemo ? (
          <p className="world-preview-note" role="status">
            Showing demo neighbors in {cityLabel || 'your city'}.{' '}
            <button type="button" className="world-preview-clear" onClick={() => setPreviewDemo(false)}>
              Back to just you
            </button>
          </p>
        ) : null}
        {data.error ? (
          <p className="world-error" role="alert">
            {data.error}
          </p>
        ) : null}
      </div>

      <div className="world-panels">
        <aside className="world-detail" aria-live="polite" aria-label="Details">
          {detail ? (
            <>
              <p className="eyebrow">Selected</p>
              <h3 className="world-detail-title">{detail.title}</h3>
              <p className="hint">{detail.subtitle}</p>
              <dl className="world-facts">
                {detail.rows.map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {detail.loan && detail.loan.step >= 0 ? (
                <div className="world-tracker">
                  <StatusTimeline steps={loanSteps} current={loanSteps[detail.loan.step]} />
                </div>
              ) : null}
            </>
          ) : (
            <p className="hint">Click a house, a walker or the hub. Drag to pan, right-drag to rotate, scroll to zoom.</p>
          )}
        </aside>

        <div className="world-table">
          <div className="admin-tabs" role="tablist" aria-label="Neighborhood lists">
            {(['loans', 'neighbors', 'groupbuys'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'admin-tab admin-tab-active' : 'admin-tab'} onClick={() => setTab(id)}>
                {{ loans: 'Loans', neighbors: 'Neighbors', groupbuys: 'Group buys' }[id]}
              </button>
            ))}
          </div>
          <ul className="admin-list">
            {tab === 'loans' && loans.length === 0 ? <li className="hint">No loans yet.</li> : null}
            {tab === 'loans'
              ? loans.map((loan) => (
                  <li key={loan.loan_id}>
                    <button type="button" className="world-row" onClick={() => setSelected(`s:${loan.loan_id}`)}>
                      <strong>{data.names.get(loan.catalog_item_id) ?? loan.catalog_item_id}</strong>
                      <span className="hint">
                        {nameOf(loan.lender_id)} → {nameOf(loan.borrower_id)} · {loan.overdue ? 'overdue' : loan.status.replace('_', ' ')}
                      </span>
                    </button>
                  </li>
                ))
              : null}
            {tab === 'neighbors'
              ? lots.map((lot) => (
                  <li key={lot.id}>
                    <button type="button" className="world-row" onClick={() => setSelected(`h:${lot.id}`)}>
                      <strong>{lot.resident.name}</strong>
                      <span className="hint">{lot.resident.street}</span>
                    </button>
                  </li>
                ))
              : null}
            {tab === 'groupbuys' && data.groupBuys.length === 0 ? <li className="hint">No group buys started.</li> : null}
            {tab === 'groupbuys'
              ? data.groupBuys.map((buy) => (
                  <li key={buy.catalog_item_id}>
                    <button type="button" className="world-row" onClick={() => setSelected('hub')}>
                      <strong>{buy.name}</strong>
                      <span className="hint">{buy.members.length} neighbors</span>
                    </button>
                  </li>
                ))
              : null}
          </ul>
        </div>
      </div>
    </section>
  )
}

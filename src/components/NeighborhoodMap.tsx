import { useEffect, useId, useRef, useState } from 'react'
import type { GeoJSONSource, Map as MapboxMap, Marker, Popup } from 'mapbox-gl/esm'
import 'mapbox-gl/dist/mapbox-gl.css'
import { api } from '../api/client.ts'
import type { ApiSampleListing } from '../api/types.ts'
import { mapboxAccessToken } from '../data/geocode.ts'
import {
  demoMapBackdrop,
  linksForResident,
  listingMapBounds,
  type MapOrigin,
  type SceneResident,
  type ShareLink,
} from '../data/neighborhood.ts'
import {
  milesToLatDegrees,
  milesToLngDegrees,
  RADIUS_QUERY_DEBOUNCE_MS,
  type RadiusMiles,
} from '../data/searchRadius.ts'

const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12'
const SAMPLE_SOURCE = 'sample-listings'
const RADIUS_SOURCE = 'search-radius'
const US_MAX_BOUNDS: [[number, number], [number, number]] = [
  [-179.5, 18],
  [-66, 72],
]

type NeighborhoodMapProps = {
  residents: readonly SceneResident[]
  links: readonly ShareLink[]
  lendingIds: ReadonlySet<string>
  selectedId: string | null
  selectedLinkId: string | null
  onSelectResident: (id: string) => void
  onSelectLink: (id: string) => void
  emptyMessage: string | null
  /** Geocoded center for the signed-in address, or the demo Park Slope origin. */
  mapOrigin: MapOrigin
  mapLabel: string
  usingDemoBackdrop: boolean
  tokenMissingMessage: string | null
  /** When true, load clustered sample listings for the current map view. */
  showSampleListings?: boolean
  /** Search radius in miles (circle + /api/listings radius query). */
  radiusMiles?: RadiusMiles
  /** Center for radius queries — verified profile lat/lng when available. */
  searchCenter?: { latitude: number; longitude: number } | null
  onSampleCountChange?: (count: number) => void
}

type MapboxModule = typeof import('mapbox-gl/esm')

export function NeighborhoodMap({
  residents,
  links,
  lendingIds,
  selectedId,
  selectedLinkId,
  onSelectResident,
  onSelectLink,
  emptyMessage,
  mapOrigin,
  mapLabel,
  usingDemoBackdrop,
  tokenMissingMessage,
  showSampleListings = false,
  radiusMiles = 2,
  searchCenter = null,
  onSampleCountChange,
}: NeighborhoodMapProps) {
  const token = mapboxAccessToken()
  const statusId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const samplePopupRef = useRef<Popup | null>(null)
  const handlersRef = useRef({ onSelectResident, onSelectLink })
  const linksRef = useRef(links)
  const residentsRef = useRef(residents)
  const selectedLinkRef = useRef(selectedLinkId)
  const selectedIdRef = useRef(selectedId)
  const originRef = useRef(mapOrigin)
  const showSampleRef = useRef(showSampleListings)
  const radiusRef = useRef(radiusMiles)
  const searchCenterRef = useRef(searchCenter)
  const sampleCountCb = useRef(onSampleCountChange)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [sampleCount, setSampleCount] = useState(0)

  useEffect(() => {
    handlersRef.current = { onSelectResident, onSelectLink }
    linksRef.current = links
    residentsRef.current = residents
    selectedLinkRef.current = selectedLinkId
    selectedIdRef.current = selectedId
    originRef.current = mapOrigin
    showSampleRef.current = showSampleListings
    radiusRef.current = radiusMiles
    searchCenterRef.current = searchCenter
    sampleCountCb.current = onSampleCountChange
  }, [
    onSelectResident,
    onSelectLink,
    links,
    residents,
    selectedLinkId,
    selectedId,
    mapOrigin,
    showSampleListings,
    radiusMiles,
    searchCenter,
    onSampleCountChange,
  ])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !token || failed) return

    let map: MapboxMap | null = null
    let cancelled = false
    let timer = 0
    const bounds = listingMapBounds(mapOrigin)

    void import('mapbox-gl/esm')
      .then((mapboxgl) => {
        if (cancelled || !containerRef.current) return
        if (!mapboxgl.supported()) {
          setFailed(true)
          return
        }

        timer = window.setTimeout(() => {
          if (!cancelled && !mapRef.current) setFailed(true)
        }, 15000)
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const [[west, south], [east, north]] = bounds
        // Prefer not to phone home — drop Mapbox telemetry when the SDK exposes it.
        const config = (mapboxgl as MapboxModule & { config?: { EVENTS_URL?: string } }).config
        if (config) config.EVENTS_URL = ''
        map = new mapboxgl.Map({
          accessToken: token,
          container,
          style: MAP_STYLE,
          center: [mapOrigin.longitude, mapOrigin.latitude],
          zoom: 13,
          minZoom: 10,
          maxZoom: demoMapBackdrop.maxZoom,
          maxBounds: bounds,
          minPitch: 0,
          maxPitch: 0,
          pitchWithRotate: false,
          dragRotate: false,
          touchPitch: false,
          cooperativeGestures: false,
          renderWorldCopies: false,
          fadeDuration: reduceMotion ? 0 : 280,
          attributionControl: true,
          logoPosition: 'bottom-left',
          collectResourceTiming: false,
          transformRequest: (url) => {
            if (/events\.mapbox\.com/i.test(url)) {
              return { url: 'data:text/plain,', headers: {} }
            }
            return { url }
          },
        })
        map.addControl(
          new mapboxgl.NavigationControl({ showCompass: false, visualizePitch: false }),
          'bottom-right',
        )
        map.touchZoomRotate.disableRotation()

        const bumpSize = () => {
          if (!map || cancelled) return
          map.resize()
        }

        map.on('load', () => {
          if (cancelled || !map) return
          window.clearTimeout(timer)
          bumpSize()
          map.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            {
              padding: viewPadding(),
              maxZoom: 14,
              duration: 0,
            },
          )
          bumpSize()
          tintWater(map)
          ensureLinkLayers(map)
          ensureSampleLayers(map)
          ensureRadiusLayer(map)
          const source = map.getSource('share-links')
          if (isGeoJsonSource(source)) {
            source.setData(linksGeoJson(residentsRef.current, linksRef.current, selectedLinkRef.current))
          }
          bindLinkClicks(map, handlersRef)
          bindSampleClicks(map, samplePopupRef)
          mapRef.current = map
          setReady(true)
          requestAnimationFrame(bumpSize)
          map.once('idle', bumpSize)
        })

        map.on('error', (event) => {
          if (cancelled) return
          // Telemetry/events failures are noisy and do not mean the basemap is unusable.
          const target = 'url' in (event.error ?? {}) ? String((event.error as { url?: string }).url ?? '') : ''
          if (/events\.mapbox\.com/i.test(target)) return
          if (isAuthFailure(event.error) || isMapLoadFailure(event.error)) setFailed(true)
        })

        const shell = container.parentElement
        const observer = new ResizeObserver(bumpSize)
        observer.observe(shell ?? container)
        map.once('remove', () => observer.disconnect())
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      setReady(false)
      markersRef.current = []
      map?.remove()
      if (mapRef.current === map) mapRef.current = null
    }
    // Recreate when the geocoded (or demo) origin changes.
  }, [token, failed, mapOrigin])

  const markerSignature = [
    residents.map((resident) => resident.id).join(','),
    links.map((link) => `${link.id}:${link.active ? 1 : 0}`).join(','),
    [...lendingIds].sort().join(','),
  ].join('|')

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    let cancelled = false
    void import('mapbox-gl/esm').then((mapboxgl) => {
      if (cancelled || mapRef.current !== map) return
      for (const marker of markersRef.current) marker.remove()
      markersRef.current = residents.map((resident) =>
        createMarker(mapboxgl, map, resident, links, lendingIds.has(resident.id), handlersRef),
      )
      if (residents.length > 0) {
        const bounds = new mapboxgl.LngLatBounds()
        for (const resident of residents) bounds.extend([resident.longitude, resident.latitude])
        map.fitBounds(bounds, { padding: 48, maxZoom: 15, animate: false })
      }
      applySelection(markersRef.current, selectedIdRef.current)
    })

    return () => {
      cancelled = true
      for (const marker of markersRef.current) marker.remove()
      markersRef.current = []
    }
  }, [ready, markerSignature, residents, links, lendingIds])

  useEffect(() => {
    applySelection(markersRef.current, selectedId)
  }, [selectedId, markerSignature])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource('share-links')
    if (!isGeoJsonSource(source)) return
    source.setData(linksGeoJson(residents, links, selectedLinkId))
  }, [ready, residents, links, selectedLinkId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const localBounds = listingMapBounds(originRef.current)
    if (showSampleListings) {
      map.setMaxBounds(US_MAX_BOUNDS)
      map.setMinZoom(3)
      return
    }
    map.setMaxBounds(localBounds)
    map.setMinZoom(10)
    samplePopupRef.current?.remove()
    samplePopupRef.current = null
    const source = map.getSource(SAMPLE_SOURCE)
    if (isGeoJsonSource(source)) {
      source.setData({ type: 'FeatureCollection', features: [] })
    }
    const clear = window.setTimeout(() => {
      setSampleCount(0)
      sampleCountCb.current?.(0)
    }, 0)
    return () => window.clearTimeout(clear)
  }, [ready, showSampleListings])

  // Draw / fit the radius circle immediately when the slider or center changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ensureRadiusLayer(map)
    const center = searchCenter ?? {
      latitude: mapOrigin.latitude,
      longitude: mapOrigin.longitude,
    }
    const source = map.getSource(RADIUS_SOURCE)
    if (isGeoJsonSource(source)) {
      source.setData(radiusCircleGeoJson(center.longitude, center.latitude, radiusMiles))
    }
    const dLat = milesToLatDegrees(radiusMiles)
    const dLng = milesToLngDegrees(radiusMiles, center.latitude)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    map.fitBounds(
      [
        [center.longitude - dLng, center.latitude - dLat],
        [center.longitude + dLng, center.latitude + dLat],
      ],
      {
        padding: viewPadding(),
        maxZoom: 14,
        duration: reduceMotion ? 0 : 350,
      },
    )
  }, [ready, radiusMiles, searchCenter, mapOrigin.latitude, mapOrigin.longitude])

  // Re-query sample listings after the slider settles (300 ms).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !showSampleListings) return

    let cancelled = false
    const center = searchCenter ?? {
      latitude: mapOrigin.latitude,
      longitude: mapOrigin.longitude,
    }
    const timer = window.setTimeout(() => {
      if (cancelled || mapRef.current !== map || !showSampleRef.current) return
      void api
        .listings(
          {
            radiusMiles,
            latitude: center.latitude,
            longitude: center.longitude,
          },
          2000,
        )
        .then((body) => {
          if (cancelled || mapRef.current !== map || !showSampleRef.current) return
          const source = map.getSource(SAMPLE_SOURCE)
          if (!isGeoJsonSource(source)) return
          source.setData(sampleListingsGeoJson(body.items))
          setSampleCount(body.count)
          sampleCountCb.current?.(body.count)
        })
        .catch(() => {
          if (cancelled || !showSampleRef.current) return
          const source = map.getSource(SAMPLE_SOURCE)
          if (isGeoJsonSource(source)) {
            source.setData({ type: 'FeatureCollection', features: [] })
          }
          setSampleCount(0)
          sampleCountCb.current?.(0)
        })
    }, RADIUS_QUERY_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    ready,
    showSampleListings,
    radiusMiles,
    searchCenter,
    mapOrigin.latitude,
    mapOrigin.longitude,
  ])

  function resetView() {
    const map = mapRef.current
    if (!map) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const people = residentsRef.current
    void import('mapbox-gl/esm').then((mapboxgl) => {
      if (mapRef.current !== map) return
      const frame = new mapboxgl.LngLatBounds()
      if (people.length === 0) {
        const [[west, south], [east, north]] = listingMapBounds(originRef.current)
        frame.extend([west, south])
        frame.extend([east, north])
      } else {
        for (const resident of people) frame.extend([resident.longitude, resident.latitude])
      }
      map.fitBounds(frame, {
        padding: viewPadding(),
        maxZoom: 15,
        pitch: 0,
        bearing: 0,
        duration: reduceMotion ? 0 : 650,
      })
    })
  }

  if (!token || failed) {
    return (
      <MapFallback
        missingToken={!token}
        reason={
          tokenMissingMessage ||
          (token
            ? 'Mapbox rejected the token or the style did not load. Check VITE_MAPBOX_ACCESS_TOKEN, its URL restrictions, and your connection.'
            : 'Add VITE_MAPBOX_ACCESS_TOKEN to .env.local and restart Relay. Use a public Mapbox token, and keep it out of source control.')
        }
        residents={residents}
        links={links}
        lendingIds={lendingIds}
        selectedId={selectedId}
        onSelectResident={onSelectResident}
        onSelectLink={onSelectLink}
        emptyMessage={emptyMessage}
      />
    )
  }

  return (
    <div className="hood-map">
      <div
        ref={containerRef}
        className="hood-map-canvas"
        role="region"
        aria-label={
          usingDemoBackdrop
            ? `Map of ${mapLabel} (demo backdrop)`
            : `Map centered on ${mapLabel}`
        }
      />
      <div className="hood-map-toolbar">
        <button type="button" className="hood-reset" onClick={resetView} disabled={!ready}>
          Neighborhood view
        </button>
        {showSampleListings ? (
          <span className="hood-sample-count" role="status">
            {sampleCount} demo listing{sampleCount === 1 ? '' : 's'} within {radiusMiles}{' '}
            mile{radiusMiles === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      {usingDemoBackdrop ? (
        <p className="hood-map-backdrop-note" role="status">
          Showing the demo map area. Set your street and city in Edit profile so Relay can center on you.
        </p>
      ) : null}
      {emptyMessage ? <p className="hood-map-empty">{emptyMessage}</p> : null}
      {ready ? null : (
        <p className="hood-map-pending" id={statusId} role="status">
          Opening the neighborhood map
        </p>
      )}
    </div>
  )
}

function MapFallback({
  missingToken,
  reason,
  residents,
  links,
  lendingIds,
  selectedId,
  onSelectResident,
  onSelectLink,
  emptyMessage,
}: {
  missingToken: boolean
  reason: string
  residents: readonly SceneResident[]
  links: readonly ShareLink[]
  lendingIds: ReadonlySet<string>
  selectedId: string | null
  onSelectResident: (id: string) => void
  onSelectLink: (id: string) => void
  emptyMessage: string | null
}) {
  return (
    <div className="hood-fallback">
      <p className="hood-fallback-title" role="status">
        {missingToken ? 'The neighborhood map needs a Mapbox token' : 'The neighborhood map could not open'}
      </p>
      <p className="hood-fallback-copy">{reason}</p>
      {emptyMessage ? <p className="hood-map-empty hood-map-empty-static">{emptyMessage}</p> : null}
      {residents.length > 0 ? (
        <ul className="hood-roster">
          {residents.map((resident) => {
            const related = linksForResident(resident.id, links)
            const lending = lendingIds.has(resident.id)
            const active = related.some((link) => link.active)
            const pending = related.some((link) => !link.active)
            return (
              <li key={resident.id}>
                <div className={markerClassName({ lending, active, pending, selected: selectedId === resident.id })}>
                  <div className="hood-marker-pin">
                    <button
                      type="button"
                      className="hood-marker-btn"
                      aria-pressed={selectedId === resident.id}
                      aria-label={markerLabel(resident, lending, active, pending)}
                      onClick={() => onSelectResident(resident.id)}
                    >
                      <span className="hood-marker-face" aria-hidden="true">
                        {resident.initials}
                      </span>
                      <span className="hood-marker-name">{resident.isYou ? 'You' : firstName(resident.name)}</span>
                    </button>
                    {related.length > 0 ? (
                      <button
                        type="button"
                        className="hood-marker-loan"
                        aria-label={loanPipLabel(related)}
                        onClick={() => {
                          if (related.length === 1 && related[0]) onSelectLink(related[0].id)
                          else onSelectResident(resident.id)
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function createMarker(
  mapboxgl: MapboxModule,
  map: MapboxMap,
  resident: SceneResident,
  links: readonly ShareLink[],
  lending: boolean,
  handlersRef: { current: { onSelectResident: (id: string) => void; onSelectLink: (id: string) => void } },
) {
  const related = linksForResident(resident.id, links)
  const active = related.some((link) => link.active)
  const pending = related.some((link) => !link.active)

  const root = document.createElement('div')
  root.className = markerClassName({ lending, active, pending, selected: false })
  root.dataset.residentId = resident.id

  const pin = document.createElement('div')
  pin.className = 'hood-marker-pin'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'hood-marker-btn'
  button.setAttribute('aria-pressed', 'false')
  button.setAttribute('aria-label', markerLabel(resident, lending, active, pending))
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    handlersRef.current.onSelectResident(resident.id)
  })

  const face = document.createElement('span')
  face.className = 'hood-marker-face'
  face.textContent = resident.initials
  face.setAttribute('aria-hidden', 'true')

  const name = document.createElement('span')
  name.className = 'hood-marker-name'
  name.textContent = resident.isYou ? 'You' : firstName(resident.name)

  button.append(face, name)
  pin.append(button)

  if (related.length > 0) {
    const pip = document.createElement('button')
    pip.type = 'button'
    pip.className = 'hood-marker-loan'
    pip.setAttribute('aria-label', loanPipLabel(related))
    pip.addEventListener('click', (event) => {
      event.stopPropagation()
      const only = related.length === 1 ? related[0] : null
      if (only) handlersRef.current.onSelectLink(only.id)
      else handlersRef.current.onSelectResident(resident.id)
    })
    pin.append(pip)
  }

  root.append(pin)
  return new mapboxgl.Marker({ element: root, anchor: 'center' })
    .setLngLat([resident.longitude, resident.latitude])
    .addTo(map)
}

function applySelection(markers: readonly Marker[], selectedId: string | null) {
  for (const marker of markers) {
    const root = marker.getElement()
    const selected = root.dataset.residentId === selectedId
    root.classList.toggle('hood-marker-selected', selected)
    root.style.zIndex = selected ? '3' : '1'
    root.querySelector('.hood-marker-btn')?.setAttribute('aria-pressed', selected ? 'true' : 'false')
  }
}

function markerClassName({
  lending,
  active,
  pending,
  selected,
}: {
  lending: boolean
  active: boolean
  pending: boolean
  selected: boolean
}) {
  return [
    'hood-marker',
    lending ? 'hood-marker-lending' : '',
    active ? 'hood-marker-active' : '',
    !active && pending ? 'hood-marker-pending' : '',
    selected ? 'hood-marker-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function markerLabel(resident: SceneResident, lending: boolean, active: boolean, pending: boolean) {
  const who = resident.isYou ? `${resident.name}, you` : resident.name
  const lend = lending ? 'Has items to lend.' : 'Nothing listed to lend.'
  const loan = active ? ' In an active loan.' : pending ? ' Has a loan request.' : ''
  return `${who}. ${lend}${loan}`
}

function loanPipLabel(links: readonly ShareLink[]) {
  if (links.length === 1 && links[0]) return `${links[0].itemName}, ${links[0].status}`
  const active = links.filter((link) => link.active).length
  return active > 0 ? `${active} active loans` : `${links.length} loan requests`
}

function firstName(name: string) {
  return name.split(' ')[0] ?? name
}

function viewPadding() {
  return { top: 72, right: 56, bottom: 78, left: 48 }
}

function isAuthFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  if (status === 401 || status === 403) return true
  return /unauthorized|forbidden|invalid token|access token/i.test(message)
}

function isMapLoadFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  if (status === 404 || status === 422 || (typeof status === 'number' && status >= 500)) return true
  return /failed to fetch|failed to load|style|tile|network|abort/i.test(message)
}

function isGeoJsonSource(source: unknown): source is GeoJSONSource {
  return Boolean(source && typeof source === 'object' && 'setData' in source)
}

function tintWater(map: MapboxMap) {
  if (!map.getLayer('water')) return
  try {
    map.setPaintProperty('water', 'fill-color', '#c5eef6')
  } catch {
    // The streets style may rename this layer. Leave the default water color.
  }
}

function ensureRadiusLayer(map: MapboxMap) {
  if (map.getSource(RADIUS_SOURCE)) return
  map.addSource(RADIUS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer({
    id: 'search-radius-fill',
    type: 'fill',
    source: RADIUS_SOURCE,
    paint: {
      'fill-color': '#14b8a6',
      'fill-opacity': 0.08,
    },
  })
  map.addLayer({
    id: 'search-radius-line',
    type: 'line',
    source: RADIUS_SOURCE,
    paint: {
      'line-color': '#0c749f',
      'line-width': 2,
      'line-opacity': 0.75,
    },
  })
}

function radiusCircleGeoJson(longitude: number, latitude: number, radiusMiles: number) {
  const points = 64
  const coordinates: [number, number][] = []
  for (let i = 0; i <= points; i += 1) {
    const bearing = (i / points) * 2 * Math.PI
    const dLat = milesToLatDegrees(radiusMiles) * Math.cos(bearing)
    const dLng = milesToLngDegrees(radiusMiles, latitude) * Math.sin(bearing)
    coordinates.push([longitude + dLng, latitude + dLat])
  }
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [coordinates] },
      },
    ],
  }
}

function ensureSampleLayers(map: MapboxMap) {
  if (map.getSource(SAMPLE_SOURCE)) return
  map.addSource(SAMPLE_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 52,
  })
  map.addLayer({
    id: 'sample-clusters',
    type: 'circle',
    source: SAMPLE_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#0c749f',
      'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 26],
      'circle-opacity': 0.82,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })
  map.addLayer({
    id: 'sample-cluster-count',
    type: 'symbol',
    source: SAMPLE_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
    },
    paint: { 'text-color': '#ffffff' },
  })
  map.addLayer({
    id: 'sample-unclustered',
    type: 'circle',
    source: SAMPLE_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#14b8a6',
      'circle-radius': 7,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })
}

type SampleMapFeature = {
  properties?: Record<string, unknown> | null
  geometry?: { type?: string; coordinates?: number[] }
}

function bindSampleClicks(
  map: MapboxMap,
  popupRef: { current: Popup | null },
) {
  map.on('click', 'sample-clusters', (event) => {
    const feature = event.features?.[0] as SampleMapFeature | undefined
    const clusterId = feature?.properties?.cluster_id
    const source = map.getSource(SAMPLE_SOURCE)
    const coords = feature?.geometry?.coordinates
    if (typeof clusterId !== 'number' || !source || !('getClusterExpansionZoom' in source)) return
    if (!coords || coords.length < 2) return
    const center: [number, number] = [Number(coords[0]), Number(coords[1])]
    ;(source as GeoJSONSource).getClusterExpansionZoom(clusterId, (error, zoom) => {
      if (error || zoom == null) return
      map.easeTo({ center, zoom })
    })
  })

  map.on('click', 'sample-unclustered', (event) => {
    const feature = event.features?.[0] as SampleMapFeature | undefined
    const coords = feature?.geometry?.coordinates
    if (!feature || feature.geometry?.type !== 'Point' || !coords || coords.length < 2) return
    const props = feature.properties ?? {}
    const coordinates: [number, number] = [Number(coords[0]), Number(coords[1])]
    const html = samplePopupHtml({
      item: String(props.item ?? 'Item'),
      city: String(props.city ?? ''),
      state: String(props.state ?? ''),
      condition: String(props.condition ?? ''),
      quantity: Number(props.quantity) || 1,
      firstName: String(props.first_name ?? ''),
      lastInitial: String(props.last_initial ?? ''),
      maxLoanHours: Number(props.max_loan_hours) || 0,
    })
    void import('mapbox-gl/esm').then((mapboxgl) => {
      popupRef.current?.remove()
      popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true, maxWidth: '240px' })
        .setLngLat(coordinates)
        .setHTML(html)
        .addTo(map)
    })
  })

  for (const layer of ['sample-clusters', 'sample-unclustered'] as const) {
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
    })
  }
}

function samplePopupHtml(listing: {
  item: string
  city: string
  state: string
  condition: string
  quantity: number
  firstName: string
  lastInitial: string
  maxLoanHours: number
}) {
  const place = [listing.city, listing.state].filter(Boolean).join(', ')
  const lender = [listing.firstName, listing.lastInitial ? `${listing.lastInitial}.` : '']
    .filter(Boolean)
    .join(' ')
  // Demo data only: no contact affordance — this pin never maps to a real resident or loan.
  return `<div class="hood-sample-popup">
    <span class="hood-sample-badge">Demo listing</span>
    <p class="hood-sample-item">${escapeHtml(listing.item)}</p>
    <p class="hood-sample-meta">${escapeHtml(place)}</p>
    <p class="hood-sample-meta">${escapeHtml(listing.condition)} · qty ${listing.quantity}</p>
    ${lender ? `<p class="hood-sample-meta">${escapeHtml(lender)} · up to ${listing.maxLoanHours}h loan</p>` : ''}
  </div>`
}

function sampleListingsGeoJson(items: readonly ApiSampleListing[]) {
  return {
    type: 'FeatureCollection' as const,
    features: items.map((item) => ({
      type: 'Feature' as const,
      properties: {
        id: item.id,
        item: item.item,
        city: item.city,
        state: item.state,
        condition: item.condition,
        quantity: item.quantity,
        first_name: item.first_name,
        last_initial: item.last_initial,
        max_loan_hours: item.max_loan_hours,
        is_sample: 1,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [item.longitude, item.latitude],
      },
    })),
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function ensureLinkLayers(map: MapboxMap) {
  if (map.getSource('share-links')) return
  map.addSource('share-links', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })

  map.addLayer({
    id: 'share-links-casing',
    type: 'line',
    source: 'share-links',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['case', ['==', ['get', 'selected'], 1], 8, 6],
      'line-opacity': 0.92,
    },
  })
  map.addLayer({
    id: 'share-links-active',
    type: 'line',
    source: 'share-links',
    filter: ['==', ['get', 'active'], 1],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'selected'], 1], '#0c756e', '#14b8a6'],
      'line-width': ['case', ['==', ['get', 'selected'], 1], 4.5, 2.75],
    },
  })
  map.addLayer({
    id: 'share-links-pending',
    type: 'line',
    source: 'share-links',
    filter: ['==', ['get', 'active'], 0],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#0c749f',
      'line-width': ['case', ['==', ['get', 'selected'], 1], 4, 2.25],
      'line-dasharray': [1.4, 1.5],
      'line-opacity': 0.9,
    },
  })
  map.addLayer({
    id: 'share-links-hit',
    type: 'line',
    source: 'share-links',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#123044',
      'line-width': 16,
      'line-opacity': 0.01,
    },
  })
}

function bindLinkClicks(
  map: MapboxMap,
  handlersRef: { current: { onSelectLink: (id: string) => void } },
) {
  map.on('click', 'share-links-hit', (event) => {
    const feature = event.features?.[0] as { properties?: { id?: unknown } } | undefined
    const id = feature?.properties?.id
    if (typeof id === 'string' && id) handlersRef.current.onSelectLink(id)
  })
  map.on('mouseenter', 'share-links-hit', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'share-links-hit', () => {
    map.getCanvas().style.cursor = ''
  })
}

function linksGeoJson(
  residents: readonly SceneResident[],
  links: readonly ShareLink[],
  selectedLinkId: string | null,
) {
  const groups = new Map<string, ShareLink[]>()
  for (const link of links) {
    const key = [link.fromId, link.toId].sort().join('|')
    const group = groups.get(key)
    if (group) group.push(link)
    else groups.set(key, [link])
  }

  return {
    type: 'FeatureCollection' as const,
    features: links.flatMap((link) => {
      const from = residents.find((resident) => resident.id === link.fromId)
      const to = residents.find((resident) => resident.id === link.toId)
      if (!from || !to) return []
      const key = [link.fromId, link.toId].sort().join('|')
      const group = groups.get(key) ?? [link]
      const slot = Math.max(0, group.findIndex((item) => item.id === link.id))
      return [
        {
          type: 'Feature' as const,
          properties: {
            id: link.id,
            active: link.active ? 1 : 0,
            selected: link.id === selectedLinkId ? 1 : 0,
          },
          geometry: {
            type: 'LineString' as const,
            coordinates: lineCoordinates(from, to, slot, group.length),
          },
        },
      ]
    }),
  }
}

function lineCoordinates(from: SceneResident, to: SceneResident, slot: number, count: number) {
  const start: [number, number] = [from.longitude, from.latitude]
  const end: [number, number] = [to.longitude, to.latitude]
  if (count < 2) return [start, end]
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length = Math.hypot(dx, dy) || 1
  const shift = (slot - (count - 1) / 2) * 0.00018
  const mid: [number, number] = [
    (start[0] + end[0]) / 2 + (-dy / length) * shift,
    (start[1] + end[1]) / 2 + (dx / length) * shift,
  ]
  return [start, mid, end]
}

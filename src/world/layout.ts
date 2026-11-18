/** Where each neighbor's house goes. Pure, so the same data always gives the same town. */

import { sameCity } from '../data/cityMatch.ts'

export const SPACING = 10

export type WorldResident = {
  id: string
  name: string
  initials: string
  street: string
  x: number
  y: number
  city: string
  latitude?: number | null
  longitude?: number | null
}

export type Lot = { id: string; col: number; row: number; x: number; z: number; resident: WorldResident }
export type Point = { x: number; z: number }

/** Cells kept free for the Relay Hub and the park. */
export const HUB_CELL = { col: 1, row: -1 }
export const PARK_CELL = { col: -1, row: -1 }

export const cellPoint = (col: number, row: number): Point => ({ x: col * SPACING, z: row * SPACING })
export const hubPoint = cellPoint(HUB_CELL.col, HUB_CELL.row)
export const parkPoint = cellPoint(PARK_CELL.col, PARK_CELL.row)

const key = (col: number, row: number) => `${col},${row}`

/**
 * Place up to `max` neighbors around the viewer, nearest first, on a grid with no two houses in one cell.
 * Real positions are scaled down so a wide neighborhood still fits in a handful of blocks.
 */
export function layoutLots(
  residents: readonly WorldResident[],
  viewerId: string,
  max = 36,
  /** Neighbors who must get a house however far away they are, e.g. anyone with a loan in progress. */
  mustInclude: ReadonlySet<string> = new Set(),
): Lot[] {
  const viewer = residents.find((resident) => resident.id === viewerId)
  const city = viewer?.city ?? ''
  const originX = viewer?.x ?? 0
  const originY = viewer?.y ?? 0
  const local = residents.filter(
    (resident) => !city || !resident.city || sameCity(resident.city, city),
  )
  const distance = (resident: WorldResident) => Math.abs(resident.x - originX) + Math.abs(resident.y - originY)

  const rank = (resident: WorldResident) => (resident.id === viewerId ? 0 : mustInclude.has(resident.id) ? 1 : 2)
  const chosen = [...local]
    .sort((a, b) => rank(a) - rank(b) || distance(a) - distance(b) || a.id.localeCompare(b.id))
    .slice(0, Math.max(max, [...local].filter((resident) => rank(resident) < 2).length))

  const extent = chosen.reduce((widest, resident) => Math.max(widest, Math.abs(resident.x - originX), Math.abs(resident.y - originY)), 0)
  const scale = Math.max(1, Math.ceil(extent / 5))

  const taken = new Set([key(HUB_CELL.col, HUB_CELL.row), key(PARK_CELL.col, PARK_CELL.row)])
  return chosen.map((resident) => {
    const wantCol = Math.round((resident.x - originX) / scale)
    const wantRow = Math.round((resident.y - originY) / scale)
    const [col, row] = nearestFree(wantCol, wantRow, taken)
    taken.add(key(col, row))
    return { id: resident.id, col, row, ...cellPoint(col, row), resident }
  })
}

function nearestFree(col: number, row: number, taken: ReadonlySet<string>): [number, number] {
  if (!taken.has(key(col, row))) return [col, row]
  for (let radius = 1; radius < 200; radius++) {
    const ring: [number, number][] = []
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) === radius) ring.push([col + dc, row + dr])
      }
    }
    ring.sort((a, b) => Math.abs(a[0] - col) + Math.abs(a[1] - row) - (Math.abs(b[0] - col) + Math.abs(b[1] - row)) || a[1] - b[1] || a[0] - b[0])
    const free = ring.find(([c, r]) => !taken.has(key(c, r)))
    if (free) return free
  }
  return [col, row]
}

export function boundsOf(lots: readonly Lot[]) {
  if (lots.length === 0) return { minX: -SPACING, maxX: SPACING, minZ: -SPACING, maxZ: SPACING }
  return {
    minX: Math.min(...lots.map((lot) => lot.x), hubPoint.x, parkPoint.x),
    maxX: Math.max(...lots.map((lot) => lot.x), hubPoint.x, parkPoint.x),
    minZ: Math.min(...lots.map((lot) => lot.z), hubPoint.z, parkPoint.z),
    maxZ: Math.max(...lots.map((lot) => lot.z), hubPoint.z, parkPoint.z),
  }
}

export type Zone = { name: string; x: number; z: number; count: number }

/** "16 Willow Court" belongs to "Willow Court". Zones are what the area switcher flies between. */
export function streetName(street: string): string {
  const name = street.replace(/^\s*\d+[a-zA-Z]?\s+/, '').trim()
  return !name || /^\d+[a-zA-Z]?$/.test(name) ? 'Neighborhood' : name
}

export function zonesOf(lots: readonly Lot[]): Zone[] {
  const groups = new Map<string, Lot[]>()
  for (const lot of lots) {
    const name = streetName(lot.resident.street)
    groups.set(name, [...(groups.get(name) ?? []), lot])
  }
  return [...groups.entries()]
    .map(([name, members]) => ({
      name,
      x: members.reduce((sum, lot) => sum + lot.x, 0) / members.length,
      z: members.reduce((sum, lot) => sum + lot.z, 0) / members.length,
      count: members.length,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

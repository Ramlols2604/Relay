import { useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import type { ApiGroupBuy } from '../api/types.ts'
import type { WorldResident } from './layout.ts'

export type WorldData = {
  residents: WorldResident[]
  names: Map<string, string>
  garden: number
  groupBuys: ApiGroupBuy[]
  error: string | null
}

const empty: WorldData = { residents: [], names: new Map(), garden: 0, groupBuys: [], error: null }

/** Real neighbors, catalog names, the exchange tally and group buys, all from the API. */
export function useWorldData(): WorldData {
  const [data, setData] = useState<WorldData>(empty)

  useEffect(() => {
    let live = true
    const loadPeople = async () => {
      try {
        const [residents, catalog] = await Promise.all([api.residents(), api.catalog()])
        if (!live) return
        setData((previous) => ({
          ...previous,
          error: null,
          residents: residents.map((row) => ({
            id: row.id,
            name: row.name,
            initials: row.initials,
            street: row.street,
            x: row.x,
            y: row.y,
            city: (row as { city?: string }).city ?? '',
          })),
          names: new Map(catalog.map((item) => [item.id, item.name])),
        }))
      } catch (caught) {
        if (live) setData((previous) => ({ ...previous, error: caught instanceof Error ? caught.message : 'The Relay API is not answering.' }))
      }
    }
    const loadTallies = async () => {
      const [garden, shared] = await Promise.allSettled([api.garden(), api.sharedDemand()])
      if (!live) return
      setData((previous) => ({
        ...previous,
        garden: garden.status === 'fulfilled' ? garden.value.count : previous.garden,
        groupBuys: shared.status === 'fulfilled' ? (shared.value.group_buys ?? []) : previous.groupBuys,
      }))
    }
    void loadPeople()
    void loadTallies()
    const tallies = window.setInterval(() => void loadTallies(), 8000)
    const people = window.setInterval(() => void loadPeople(), 60000)
    return () => {
      live = false
      window.clearInterval(tallies)
      window.clearInterval(people)
    }
  }, [])

  return data
}

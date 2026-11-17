import { useEffect, useState } from 'react'
import { Sprout } from 'lucide-react'
import { api } from '../api/client.ts'
import { gardenCopy } from '../data/gardenCount.ts'

const refreshMs = 15_000

/** Running tally of loans returned and handoffs received. Stays hidden if the API is down. */
export function GardenTile() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      api
        .garden()
        .then((next) => {
          if (live && typeof next.count === 'number') setCount(next.count)
        })
        .catch(() => {})
    void load()
    const timer = window.setInterval(() => void load(), refreshMs)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])

  if (count === null) return null
  const copy = gardenCopy(count)
  return (
    <p className="garden-tile" role="status">
      <Sprout aria-hidden="true" size={16} />
      <span className="garden-tile-value">{copy.value}</span>
      <span>{copy.label}</span>
    </p>
  )
}

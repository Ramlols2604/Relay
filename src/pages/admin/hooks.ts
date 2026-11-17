import { useCallback, useEffect, useState } from 'react'

export function messageOf(caught: unknown, fallback = 'Something went wrong.') {
  return caught instanceof Error ? caught.message : fallback
}

type Loaded<T> = { data: T | null; error: string | null }

/** Loads on mount and whenever `version` or `load` changes. Keeps the last result while reloading. */
export function useLoad<T>(load: () => Promise<T>, version = 0) {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null })

  useEffect(() => {
    let live = true
    load()
      .then((data) => {
        if (live) setState({ data, error: null })
      })
      .catch((caught: unknown) => {
        if (live) setState((previous) => ({ data: previous.data, error: messageOf(caught) }))
      })
    return () => {
      live = false
    }
  }, [load, version])

  return { ...state, loading: state.data === null && state.error === null }
}

/** Runs one admin action at a time, then calls `done`. Errors are kept for the screen to show. */
export function useRunner(done: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      if (busy) return false
      setBusy(true)
      setError(null)
      try {
        await action()
        done()
        return true
      } catch (caught) {
        setError(messageOf(caught))
        return false
      } finally {
        setBusy(false)
      }
    },
    [busy, done],
  )

  return { run, busy, error }
}

export function useReload() {
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return { version, reload }
}

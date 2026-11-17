import { useEffect, useState } from 'react'
import { admin } from '../api/client.ts'

let cached: Promise<boolean> | null = null

/** True when the API says this account is an admin. Asked once; any failure means no. */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    let live = true
    cached ??= admin.me().then(
      () => true,
      () => false,
    )
    void cached.then((value) => {
      if (live) setIsAdmin(value)
    })
    return () => {
      live = false
    }
  }, [])
  return isAdmin
}

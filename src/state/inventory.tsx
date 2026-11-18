import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api } from '../api/client.ts'
import { CACHE_KEYS, get, getActiveUser, setActiveUser } from '../api/cache.ts'
import type { ApiInventory, ApiInventoryItem } from '../api/types.ts'
import {
  normalizeToolName,
  type InventoryDraft,
  type InventoryItem,
} from '../data/bookshelfProject.ts'
import { InventoryContext } from './inventoryStore.ts'

function cachedShelf(residentId: string): ApiInventory | null {
  if (getActiveUser() !== residentId) setActiveUser(residentId)
  return get<ApiInventory>(CACHE_KEYS.inventory)?.value ?? null
}

export function InventoryProvider({ residentId, children }: { residentId: string; children: ReactNode }) {
  const cached = cachedShelf(residentId)
  const [items, setItems] = useState<InventoryItem[]>(() => (cached ? cached.items.map(toShelfItem) : []))
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(() => (cached ? 'ready' : 'loading'))
  const [message, setMessage] = useState(() =>
    cached && cached.snowflake !== 'ok'
      ? cached.snowflake_message || 'Showing the shelf saved on this machine.'
      : '',
  )

  useEffect(() => {
    let cancel = false
    const prior = cachedShelf(residentId)
    if (prior) {
      setItems(prior.items.map(toShelfItem))
      setStatus('ready')
      setMessage(
        prior.snowflake === 'ok' ? '' : prior.snowflake_message || 'Showing the shelf saved on this machine.',
      )
    } else {
      setStatus('loading')
    }
    api
      .inventory(residentId)
      .then((body) => {
        if (cancel) return
        setItems(body.items.map(toShelfItem))
        if (body.snowflake === 'ok' || body.items.length > 0) {
          setStatus('ready')
          setMessage(body.snowflake === 'ok' ? '' : body.snowflake_message || 'Showing the shelf saved on this machine.')
          return
        }
        if (prior) {
          setStatus('ready')
          setMessage('Offline, showing saved info')
          return
        }
        setStatus('error')
        setMessage(body.snowflake_message || 'Snowflake inventory is not available.')
      })
      .catch((error: unknown) => {
        if (cancel) return
        if (prior) {
          setStatus('ready')
          setMessage('Offline, showing saved info')
          return
        }
        setItems([])
        setStatus('error')
        setMessage(error instanceof Error ? error.message : 'Could not load inventory.')
      })
    return () => {
      cancel = true
    }
  }, [residentId])

  const markSaving = useCallback((id: string) => {
    setSavingIds((current) => new Set(current).add(id))
  }, [])

  const clearSaving = useCallback((id: string) => {
    setSavingIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }, [])

  const addItem = useCallback(async (draft: InventoryDraft) => {
    const next = sanitizeDraft(draft)
    if (!next) return 'Give this item a name first.'
    if (hasDuplicateName(items, next.name)) return 'That name is already on your shelf.'
    const tempId = `temp:${crypto.randomUUID()}`
    const optimistic: InventoryItem = { id: tempId, ...next }
    setItems((current) => [...current, optimistic])
    markSaving(tempId)
    try {
      const saved = await api.createInventory(residentId, shelfBody(next))
      const confirmed = toShelfItem(saved)
      setItems((current) => current.map((item) => (item.id === tempId ? confirmed : item)))
      return null
    } catch (caught) {
      setItems((current) => current.filter((item) => item.id !== tempId))
      return shelfProblem(caught)
    } finally {
      clearSaving(tempId)
    }
  }, [clearSaving, items, markSaving, residentId])

  const updateItem = useCallback(async (id: string, draft: InventoryDraft) => {
    const next = sanitizeDraft(draft)
    if (!next) return 'Give this item a name first.'
    if (hasDuplicateName(items, next.name, id)) return 'That name is already on your shelf.'
    const previous = items.find((item) => item.id === id)
    if (!previous) return 'That item is no longer on your shelf.'
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)))
    markSaving(id)
    try {
      const saved = await api.updateInventory(residentId, id, shelfBody(next))
      setItems((current) => current.map((item) => (item.id === id ? toShelfItem(saved) : item)))
      return null
    } catch (caught) {
      setItems((current) => current.map((item) => (item.id === id ? previous : item)))
      return shelfProblem(caught)
    } finally {
      clearSaving(id)
    }
  }, [clearSaving, items, markSaving, residentId])

  const removeItem = useCallback(async (id: string) => {
    const previous = items
    setItems((current) => current.filter((item) => item.id !== id))
    markSaving(id)
    try {
      await api.deleteInventory(residentId, id)
      return null
    } catch (caught) {
      setItems(previous)
      return shelfProblem(caught)
    } finally {
      clearSaving(id)
    }
  }, [clearSaving, items, markSaving, residentId])

  const setAvailableToLend = useCallback(async (id: string, available: boolean) => {
    const current = items.find((item) => item.id === id)
    if (!current) return 'That item is no longer on your shelf.'
    setItems((rows) => rows.map((item) => (item.id === id ? { ...item, availableToLend: available } : item)))
    markSaving(id)
    try {
      const saved = await api.updateInventory(residentId, id, shelfBody({ ...current, availableToLend: available }))
      setItems((rows) => rows.map((item) => (item.id === id ? toShelfItem(saved) : item)))
      return null
    } catch (caught) {
      setItems((rows) => rows.map((item) => (item.id === id ? current : item)))
      return shelfProblem(caught)
    } finally {
      clearSaving(id)
    }
  }, [clearSaving, items, markSaving, residentId])

  const value = useMemo(
    () => ({ items, savingIds, status, message, addItem, updateItem, removeItem, setAvailableToLend }),
    [items, savingIds, status, message, addItem, updateItem, removeItem, setAvailableToLend],
  )

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>
}

function sanitizeDraft(draft: InventoryDraft): Omit<InventoryItem, 'id'> | null {
  const name = draft.name.trim().replace(/\s+/g, ' ')
  if (!name) return null

  const quantity = Math.max(1, Math.min(99, Math.round(Number(draft.quantity)) || 1))

  return {
    name,
    category: draft.category,
    quantity,
    condition: draft.condition,
    notes: draft.notes.trim().replace(/\s+/g, ' '),
    availableToLend: draft.availableToLend,
  }
}

const shelfCategories = ['Tools', 'Garden', 'Kitchen', 'Household', 'Sports'] as const
const shelfConditions = ['Excellent', 'Good', 'Fair'] as const

function shelfBody(item: Omit<InventoryItem, 'id'>) {
  return {
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    condition: item.condition,
    notes: item.notes,
    available_to_lend: item.availableToLend,
  }
}

function toShelfItem(row: ApiInventoryItem): InventoryItem {
  const name = row.catalog_name || row.catalog_item || 'Item'
  const quantity = Number(row.quantity)
  const category = shelfCategories.find((value) => value === row.category) ?? 'Household'
  const condition = shelfConditions.find((value) => value === row.condition) ?? 'Good'
  return {
    id: row.inventory_id || `${row.resident_id}:${row.catalog_item}`,
    name,
    category,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    condition,
    notes: row.condition_note || '',
    availableToLend: Boolean(row.willing_to_lend),
  }
}

function shelfProblem(caught: unknown) {
  if (caught instanceof ApiError) return caught.message
  if (caught instanceof Error && caught.message) return caught.message
  return 'The shelf could not be saved.'
}

function hasDuplicateName(items: readonly InventoryItem[], name: string, ignoreId?: string) {
  const key = normalizeToolName(name)
  return items.some(
    (item) => item.id !== ignoreId && normalizeToolName(item.name) === key,
  )
}

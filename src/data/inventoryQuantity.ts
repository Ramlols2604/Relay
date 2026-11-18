/** Keep only digits while the user is typing a quantity. */
export function inventoryQuantityDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3)
}

export type InventoryQuantityParse =
  | { ok: true; value: number }
  | { ok: false; error: string }

/**
 * Parse a quantity string for save/blur.
 * Empty or non-whole values fail. Valid numbers are clamped to 1–99.
 */
export function parseInventoryQuantity(raw: string): InventoryQuantityParse {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'Enter a quantity from 1 to 99.' }
  }
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: 'Quantity must be a whole number.' }
  }
  const value = Number(trimmed)
  if (!Number.isInteger(value)) {
    return { ok: false, error: 'Quantity must be a whole number.' }
  }
  return { ok: true, value: Math.max(1, Math.min(99, value)) }
}

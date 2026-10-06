export type UnitQuantities = { dona: number; kg: number }
export type InventoryQuantities = {
  start: UnitQuantities
  current: UnitQuantities
  sold: UnitQuantities
  sellable: UnitQuantities
}

const finite = (value: number | undefined) => Number.isFinite(value) ? value! : 0
const rounded = (value: number) => Math.round(finite(value) * 1000) / 1000 || 0

/** Never combine counts and weights into a single quantity. */
export function sumQuantities(items: readonly { quantity: number; unit?: string | null }[]): UnitQuantities {
  const totals = { dona: 0, kg: 0 }
  for (const item of items) {
    totals[item.unit === 'kg' ? 'kg' : 'dona'] += finite(item.quantity)
  }
  return { dona: rounded(totals.dona), kg: rounded(totals.kg) }
}

export function addQuantities(a: UnitQuantities, b: UnitQuantities): UnitQuantities {
  return { dona: rounded(a.dona + b.dona), kg: rounded(a.kg + b.kg) }
}

type QuantityRow = {
  productId?: string
  product?: { id?: string; _id?: string; localId?: string; unit?: string } | null
  unit?: string
  date?: string
  updatedAt?: string
  createdAt?: string
  startQuantity?: number
  openingQuantity?: number
  currentQuantity?: number
  remaining?: number
  sold?: number
  lockedSold?: number
}

/** Sales cover every day; stock exists only once, in each product's latest entry. */
export function getInventoryQuantities(
  items: readonly QuantityRow[],
  summary?: { quantities?: InventoryQuantities } | null,
): InventoryQuantities {
  if (summary?.quantities) return summary.quantities
  const unique = new Map<string, QuantityRow>()
  const stamp = (row: QuantityRow) => row.updatedAt ?? row.createdAt ?? ''
  const idOf = (row: QuantityRow) => row.product?.localId ?? row.product?.id ?? row.product?._id ?? row.productId
  for (const item of items) {
    const id = idOf(item)
    if (!id) continue
    const key = `${id}|${item.date ?? ''}`
    const previous = unique.get(key)
    if (!previous || stamp(item) >= stamp(previous)) unique.set(key, item)
  }
  const latest = new Map<string, QuantityRow>(), first = new Map<string, QuantityRow>()
  const sales: { quantity: number; unit?: string }[] = []
  for (const item of unique.values()) {
    const id = idOf(item)!
    const opening = finite(item.startQuantity ?? item.openingQuantity)
    const current = Math.max(finite(item.currentQuantity ?? item.remaining), 0)
    sales.push({
      quantity: Math.max(finite(item.sold ?? (finite(item.lockedSold) + Math.max(opening - current, 0))), 0),
      unit: item.unit ?? item.product?.unit,
    })
    if (!latest.has(id) || (item.date ?? '') >= (latest.get(id)!.date ?? '')) latest.set(id, item)
    if (!first.has(id) || (item.date ?? '') < (first.get(id)!.date ?? '')) first.set(id, item)
  }
  const start = sumQuantities(Array.from(first.values(), item => ({
    quantity: finite(item.startQuantity ?? item.openingQuantity) + finite(item.lockedSold),
    unit: item.unit ?? item.product?.unit,
  })))
  const current = sumQuantities(Array.from(latest.values(), item => ({
    quantity: Math.max(finite(item.remaining ?? item.currentQuantity), 0),
    unit: item.unit ?? item.product?.unit,
  })))
  const sold = sumQuantities(sales)
  return { start, current, sold, sellable: addQuantities(sold, current) }
}

/** Bounded precision, no binary float tails, exponent notation or negative zero. */
export function formatDecimal(value: number, digits = 3, grouped = false): string {
  const safe = Number.isFinite(value) ? value : 0
  const factor = 10 ** digits
  const scaled = safe * factor
  const rounded = (Number.isFinite(scaled) ? Math.round(scaled) / factor : safe) || 0
  return rounded.toLocaleString(grouped ? 'uz-UZ' : 'en-US', {
    useGrouping: grouped,
    maximumFractionDigits: digits,
  })
}

/** Money editing preserves a weighed line's tiyin instead of turning 254.3 into 2543. */
export function formatInputMoney(value: string): string {
  const cleaned = value.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [whole, ...fraction] = cleaned.split('.')
  if (!whole && !fraction.length) return ''
  const number = Number(whole || '0')
  const grouped = Number.isFinite(number) ? number.toLocaleString('uz-UZ', { maximumFractionDigits: 0 }) : '0'
  return fraction.length ? `${grouped}.${fraction.join('').slice(0, 2)}` : grouped
}

export function parseInputMoney(value: string): number {
  const normalized = formatInputMoney(value).replace(/\s/g, '')
  const number = Number(normalized)
  return Number.isFinite(number) ? number : 0
}

export function formatUnitQuantities(value: UnitQuantities): string {
  return `${formatDecimal(value.dona, 0)} dona / ${formatDecimal(value.kg)} kg`
}

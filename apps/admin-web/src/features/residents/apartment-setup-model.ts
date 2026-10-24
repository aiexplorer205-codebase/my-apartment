import { parseResidentCsv } from './resident-csv'

export const apartmentHeaders = ['block', 'floor', 'flatNumber', 'fullName', 'email', 'phone', 'occupancyType', 'startDate'] as const
export const getApartmentHeaders = (multipleBlocks: boolean) => apartmentHeaders.filter((header) => multipleBlocks || header !== 'block')
export type ResidentDetails = { fullName: string; email: string; phone: string; occupancyType: string; startDate: string }
export type DraftFlat = { number: string; floorNumber: number; row?: number; resident?: ResidentDetails }
export type DraftBlock = { id?: string; name: string; floors: number; flats: DraftFlat[] }
export type SetupInventory = {
  allowedBlocks: number; flatAllowances: Array<number | null>
  blocks: Array<{ id: string; name: string; floors: number; flatLimit: number | null; allowanceSlot: number; unitCount: number }>
  units: Array<{ id: string; buildingId: string | null; number: string; floorNumber: number }>
}
export type SetupError = { block: number; flat?: number; row?: number; field: string; message: string }
export type SetupReview = { reviewId: string | null; blocks: DraftBlock[]; errors: SetupError[]; summary: { blocks: number; floors: number; flats: number; invitations: number } }
export type SetupResult = { created?: boolean; reviewId?: string; summary?: SetupReview['summary']; invitations: Array<{ id: string; email: string; fullName: string; number: string; status: string; error?: string }> }

function parseCsvStartDate(value: string, row: string): string {
  if (!value) return ''
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value)
  if (!match) throw new Error(`Row ${row}: startDate must use DD-MM-YYYY`)
  const [, day, month, year] = match
  const isoDate = `${year}-${month}-${day}`
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (date.toISOString().slice(0, 10) !== isoDate) throw new Error(`Row ${row}: startDate must be a valid date in DD-MM-YYYY format`)
  return isoDate
}

export function availableSlots(inventory: SetupInventory) {
  return Array.from({ length: inventory.allowedBlocks }, (_, i) => i).filter((slot) => !inventory.blocks.some((b) => b.allowanceSlot === slot))
}
export function blockAllowance(block: DraftBlock, drafts: DraftBlock[], inventory: SetupInventory) {
  const existing = inventory.blocks.find((b) => b.id === block.id)
  const slot = availableSlots(inventory)[drafts.filter((b) => !b.id).indexOf(block)]
  return { used: existing?.unitCount ?? 0, limit: existing ? existing.flatLimit : inventory.flatAllowances[slot ?? -1] ?? null }
}
export function parseApartmentCsv(text: string, inventory: SetupInventory): DraftBlock[] {
  const rows = parseResidentCsv(text, apartmentHeaders, true, inventory.allowedBlocks === 1 ? ['block'] : [])
  const blocks: DraftBlock[] = []
  for (const row of rows) {
    const name = row.block || (inventory.allowedBlocks === 1 ? inventory.blocks[0]?.name ?? 'Block 1' : '')
    const existing = inventory.blocks.find((b) => b.name.toLowerCase() === name.toLowerCase())
    let block = blocks.find((b) => b.name.toLowerCase() === name.toLowerCase())
    if (!block) { block = { ...(existing ? { id: existing.id } : {}), name: existing?.name ?? name, floors: existing?.floors ?? 1, flats: [] }; blocks.push(block) }
    const floor = /^\d+$/.test(row.floor ?? '') ? Number(row.floor) : 0
    if (floor >= 1 && floor <= 200) block.floors = Math.max(block.floors, floor)
    block.flats.push({ number: row.flatNumber ?? '', floorNumber: floor, row: Number(row.__row), resident: { fullName: row.fullName ?? '', email: row.email ?? '', phone: row.phone ?? '', occupancyType: row.occupancyType || 'owner', startDate: parseCsvStartDate(row.startDate ?? '', row.__row ?? '?') } })
  }
  return blocks
}

export function nextFlatNumber(block: DraftBlock, floor: number, drafts: DraftBlock[], inventory: SetupInventory) {
  const used = new Set([...inventory.units.map((u) => u.number), ...drafts.flatMap((b) => b.flats.map((f) => f.number))].map((n) => n.trim().toLowerCase()))
  const prefix = inventory.allowedBlocks > 1 ? `${block.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 12) || 'Flat'}-` : ''
  let index = 1, number = ''
  do { number = `${prefix}${floor}${String(index++).padStart(2, '0')}` } while (used.has(number.toLowerCase()))
  return number
}

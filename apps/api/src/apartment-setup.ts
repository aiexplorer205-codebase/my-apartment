import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { ApiFault } from './api-fault.js'

type Access = { tenantId: string; subject: string; role: string }
type Resident = { fullName: string; email: string; phone: string | null; occupancyType: 'owner' | 'tenant'; startDate: string; unitId: string }
export type SetupFlat = { number: string; floorNumber: number; row?: number; resident?: Record<string, unknown> | null }
export type SetupBlock = { id?: string; name: string; floors: number; flats: SetupFlat[] }
export type SetupInventory = {
  allowedBlocks: number; flatAllowances: Array<number | null>
  blocks: Array<{ id: string; name: string; floors: number; flatLimit: number | null; allowanceSlot: number; unitCount: number }>
  units: Array<{ id: string; buildingId: string | null; number: string; floorNumber: number }>
  conflicts: Array<{ email: string }>
}
export type SetupError = { block: number; flat?: number; row?: number; field: string; message: string }
type ParseResident = (raw: unknown) => Resident
const key = (value: string) => value.trim().toLocaleLowerCase('en')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function loadSetupInventory(client: Pool | PoolClient, platform: Pool, tenantId: string): Promise<SetupInventory> {
  const allowance = await platform.query<{ allowed_blocks: number; allowed_flats_per_block: number[] | null }>('SELECT allowed_blocks, allowed_flats_per_block FROM tenant_records WHERE tenant_id = $1', [tenantId])
  const allowedBlocks = Number(allowance.rows[0]?.allowed_blocks ?? 0)
  const blocks = await client.query<SetupInventory['blocks'][number]>(
    `SELECT b.id, b.name, GREATEST(b.floors, COALESCE(MAX(u.floor_number), 1)) AS floors, b.flat_limit AS "flatLimit", b.allowance_slot AS "allowanceSlot", COUNT(u.id)::int AS "unitCount"
     FROM apartment_buildings b LEFT JOIN units u ON u.apartment_building_id = b.id AND u.tenant_id = b.tenant_id
     WHERE b.tenant_id = $1 GROUP BY b.id ORDER BY b.allowance_slot`, [tenantId])
  const units = await client.query<SetupInventory['units'][number]>('SELECT id, apartment_building_id AS "buildingId", number, floor_number AS "floorNumber" FROM units WHERE tenant_id = $1', [tenantId])
  const conflicts = await client.query<{ email: string }>(
    `SELECT lower(r.email::text) AS email FROM residents r JOIN units u ON u.id = r.unit_id WHERE u.tenant_id = $1
     UNION SELECT lower(email::text) FROM resident_invitations WHERE tenant_id = $1 AND status = 'pending' AND expires_at > NOW()`, [tenantId])
  return { allowedBlocks, flatAllowances: Array.from({ length: allowedBlocks }, (_, i) => allowance.rows[0]?.allowed_flats_per_block?.[i] ?? null), blocks: blocks.rows, units: units.rows, conflicts: conflicts.rows }
}

export function validateApartmentSetup(raw: unknown, inventory: SetupInventory, parseResident: ParseResident) {
  const candidates = (raw as { blocks?: unknown[] } | null)?.blocks
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 500) throw new ApiFault(400, 'invalid_request', 'Choose between 1 and 500 blocks')
  const errors: SetupError[] = [], blocks: SetupBlock[] = []
  const slots = Array.from({ length: inventory.allowedBlocks }, (_, i) => i).filter((slot) => !inventory.blocks.some((b) => b.allowanceSlot === slot))
  const numbers = new Set(inventory.units.map((unit) => key(unit.number)))
  const names = new Set(inventory.blocks.map((block) => key(block.name)))
  const emails = new Set(inventory.conflicts.map((row) => row.email))
  const ids = new Set<string>()
  let newBlocks = 0, total = 0
  for (const [bi, candidate] of candidates.entries()) {
    const input = (candidate && typeof candidate === 'object' ? candidate : {}) as SetupBlock
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    const existing = input.id ? inventory.blocks.find((block) => block.id === input.id) : undefined
    const addError = (field: string, message: string, fi?: number, row?: number) => {
      const csvRow = row ?? (Array.isArray(input.flats) ? input.flats[0]?.row : undefined)
      errors.push({ block: bi, ...(fi !== undefined ? { flat: fi } : {}), ...(Number.isInteger(csvRow) ? { row: csvRow } : {}), field, message })
    }
    if (input.id && (!existing || ids.has(input.id))) addError('name', 'Choose an existing block in this apartment only once.')
    if (input.id) ids.add(input.id)
    const limit = existing ? existing.flatLimit : inventory.flatAllowances[slots[newBlocks] ?? -1] ?? null
    if (!input.id) {
      if (newBlocks >= slots.length) addError('name', `Only ${inventory.allowedBlocks} blocks are permitted; ${inventory.blocks.length} already exist.`)
      newBlocks++
      if (names.has(key(name))) addError('name', 'This block name already exists. Choose a different name.')
      names.add(key(name))
    } else if (existing && name !== existing.name) addError('name', 'The existing block name has changed. Reload setup.')
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'’()&/#-]{0,79}$/u.test(name)) addError('name', 'Enter a block name of 1–80 characters, starting with a letter or number.')
    if (!Number.isInteger(input.floors) || input.floors < 1 || input.floors > 200) addError('floors', 'Enter a whole number of floors between 1 and 200.')
    const highestExisting = Math.max(1, ...inventory.units.filter((u) => u.buildingId === input.id).map((u) => u.floorNumber))
    if (existing && input.floors < Math.max(existing.floors, highestExisting)) addError('floors', 'Existing floors cannot be removed in setup.')
    const flats = Array.isArray(input.flats) ? input.flats : []
    if (!Array.isArray(input.flats) || flats.length > 20000) addError('flats', 'Provide no more than 20,000 flats per block.')
    total += flats.length
    if (limit !== null && flats.length + (existing?.unitCount ?? 0) > limit) addError('flats', `This ${inventory.allowedBlocks > 1 ? 'block' : 'apartment'} allows ${limit} flats; ${existing?.unitCount ?? 0} already exist. Remove excess flats.`)
    const parsedFlats: SetupFlat[] = []
    for (const [fi, candidateFlat] of flats.entries()) {
      const flat = (candidateFlat && typeof candidateFlat === 'object' ? candidateFlat : {}) as SetupFlat
      const number = typeof flat.number === 'string' ? flat.number.trim() : ''
      const row = Number.isInteger(flat.row) && flat.row! >= 2 ? flat.row : undefined
      if (!Number.isInteger(flat.floorNumber) || flat.floorNumber < 1 || flat.floorNumber > 200 || flat.floorNumber > input.floors) addError('floorNumber', 'Floor must be a whole number from 1 to the configured floor count (maximum 200).', fi, row)
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ./_#-]{0,39}$/u.test(number)) addError('number', 'Enter a flat number of 1–40 characters, starting with a letter or number.', fi, row)
      if (numbers.has(key(number))) addError('number', 'Duplicate flat number. Use a unique number across the apartment (for example A-101).', fi, row)
      numbers.add(key(number))
      let resident: Resident | undefined
      if (flat.resident && ['fullName', 'email', 'phone'].some((field) => String(flat.resident?.[field] ?? '').trim())) {
        try {
          resident = parseResident({ ...flat.resident, unitId: '00000000-0000-4000-8000-000000000001' })
          if (emails.has(resident.email)) addError('resident', 'This email already has a resident, pending invitation, or another row in this upload.', fi, row)
          emails.add(resident.email)
        } catch (cause) { addError('resident', cause instanceof Error ? cause.message : 'Check resident details.', fi, row) }
      }
      parsedFlats.push({ number, floorNumber: flat.floorNumber, ...(row ? { row } : {}), ...(resident ? { resident } : {}) })
    }
    blocks.push({ ...(existing ? { id: existing.id } : {}), name, floors: input.floors, flats: parsedFlats })
  }
  if (total > 100000) errors.push({ block: 0, field: 'flats', message: 'Create no more than 100,000 flats at once.' })
  return { blocks, errors, summary: { blocks: blocks.length, floors: blocks.reduce((sum, b) => sum + (Number.isInteger(b.floors) ? b.floors : 0), 0), flats: total, invitations: blocks.reduce((sum, b) => sum + b.flats.filter((f) => f.resident).length, 0) } }
}

export async function apartmentSetup(pool: Pool, platform: Pool, access: Access, action: 'inventory' | 'review' | 'confirm' | 'latest', raw: unknown, parseResident: ParseResident) {
  if (access.role !== 'admin') throw new ApiFault(403, 'forbidden', 'This operation requires the admin role')
  const client = await pool.connect()
  try {
    if (action === 'inventory') {
      const inventory = await loadSetupInventory(client, platform, access.tenantId)
      return { allowedBlocks: inventory.allowedBlocks, flatAllowances: inventory.flatAllowances, blocks: inventory.blocks, units: inventory.units }
    }
    if (action === 'latest') {
      const result = await client.query("SELECT result FROM apartment_setup_reviews WHERE tenant_id = $1 AND created_by = $2 AND result IS NOT NULL AND jsonb_array_length(result->'invitations') > 0 ORDER BY confirmed_at DESC LIMIT 1", [access.tenantId, access.subject])
      const saved = result.rows[0]?.result
      if (!saved) return { invitations: [] }
      const statuses = await client.query<{ id: string; status: string; error: string | null }>('SELECT id, status, error FROM resident_import_rows WHERE tenant_id = $1 AND created_by = $2 AND id = ANY($3::uuid[])', [access.tenantId, access.subject, saved.invitations.map((i: { id: string }) => i.id)])
      return { ...saved, invitations: saved.invitations.map((i: { id: string }) => ({ ...i, ...statuses.rows.find((row) => row.id === i.id) })) }
    }
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [access.tenantId])
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [access.tenantId + ':resident-invitations'])
    let input = raw
    let reviewId = ''
    if (action === 'confirm') {
      reviewId = (raw as { reviewId?: string })?.reviewId ?? ''
      if (!uuid.test(reviewId)) throw new ApiFault(400, 'invalid_request', 'Review the apartment before creating it.')
      const saved = await client.query<{ payload: unknown; result: object | null }>('SELECT payload, result FROM apartment_setup_reviews WHERE id = $1 AND tenant_id = $2 AND created_by = $3 FOR UPDATE', [reviewId, access.tenantId, access.subject])
      if (!saved.rows[0]) throw new ApiFault(404, 'not_found', 'Apartment review not found. Review the apartment again.')
      if (saved.rows[0].result) { await client.query('COMMIT'); return saved.rows[0].result }
      input = saved.rows[0].payload
    }
    const inventory = await loadSetupInventory(client, platform, access.tenantId)
    const review = validateApartmentSetup(input, inventory, parseResident)
    if (review.errors.length) {
      if (action === 'confirm') throw new ApiFault(409, 'invalid_request', `Setup changed. Review the apartment again. ${review.errors[0]!.message}`)
      await client.query('COMMIT')
      return { ...review, reviewId: null }
    }
    if (action === 'review') {
      reviewId = randomUUID()
      await client.query('INSERT INTO apartment_setup_reviews(id, tenant_id, created_by, payload) VALUES ($1,$2,$3,$4::jsonb)', [reviewId, access.tenantId, access.subject, JSON.stringify({ blocks: review.blocks })])
      await client.query('COMMIT')
      return { ...review, reviewId }
    }
    const apartment = await client.query<{ id: string }>('SELECT id FROM apartments WHERE tenant_id = $1 ORDER BY created_at LIMIT 1', [access.tenantId])
    const apartmentId = apartment.rows[0]?.id
    if (!apartmentId) throw new ApiFault(409, 'invalid_request', 'The apartment workspace is not initialized.')
    const slots = Array.from({ length: inventory.allowedBlocks }, (_, i) => i).filter((slot) => !inventory.blocks.some((b) => b.allowanceSlot === slot))
    const invitations: Array<{ id: string; email: string; fullName: string; number: string; status: string }> = []
    const batchId = randomUUID()
    let rowNumber = 2
    for (const block of review.blocks) {
      let buildingId = block.id
      if (!buildingId) {
        const slot = slots.shift()!
        const result = await client.query<{ id: string }>(
          'INSERT INTO apartment_buildings(tenant_id,apartment_id,name,flat_limit,allowance_slot,floors) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [access.tenantId, apartmentId, block.name, inventory.flatAllowances[slot] ?? null, slot, block.floors])
        buildingId = result.rows[0]!.id
      } else await client.query('UPDATE apartment_buildings SET floors = GREATEST(floors, $3) WHERE id = $1 AND tenant_id = $2', [buildingId, access.tenantId, block.floors])
      for (const flat of block.flats) {
        const unitId = randomUUID()
        await client.query("INSERT INTO units(id,tenant_id,number,status,building_name,floor_number,apartment_id,apartment_building_id) VALUES($1,$2,$3,'vacant',$4,$5,$6,$7)", [unitId, access.tenantId, flat.number, block.name, flat.floorNumber, apartmentId, buildingId])
        if (flat.resident) {
          const id = randomUUID()
          await client.query('INSERT INTO resident_import_rows(id,tenant_id,created_by,batch_id,row_number,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [id, access.tenantId, access.subject, batchId, rowNumber++, JSON.stringify({ ...flat.resident, unitId })])
          invitations.push({ id, email: String(flat.resident.email), fullName: String(flat.resident.fullName), number: flat.number, status: 'ready' })
        }
      }
    }
    const result = { created: true, reviewId, summary: review.summary, invitations }
    await client.query('UPDATE apartment_setup_reviews SET result = $2::jsonb, confirmed_at = NOW() WHERE id = $1', [reviewId, JSON.stringify(result)])
    await client.query('COMMIT')
    return result
  } catch (cause) {
    if (action === 'review' || action === 'confirm') await client.query('ROLLBACK')
    const code = (cause as { code?: string })?.code
    if (code === '23505' || code === '40001' || code === '40P01') throw new ApiFault(409, 'invalid_request', 'The apartment changed. Review setup again; nothing was created.')
    if (code === '42P01' || code === '42703') throw new ApiFault(503, 'dependency_unavailable', 'Apply tenant migrations 030–033 before using apartment setup.')
    throw cause
  } finally { client.release() }
}

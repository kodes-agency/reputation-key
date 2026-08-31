import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0142_guest_network_pressure.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; tag: string }> }

describe('0142 canonical Guest network-pressure migration', () => {
  it('creates one content-free tenant/Property/Portal authority with an exact seven-day deadline', () => {
    expect(migration).toContain('CREATE TABLE "guest_network_pressure_records"')
    expect(migration).toContain('guest_network_pressure_portal_fk')
    expect(migration).toContain('guest_network_pressure_retention_valid')
    expect(migration).not.toContain('"id" uuid PRIMARY KEY DEFAULT gen_random_uuid()')
    expect(migration).toContain("interval '7 days'")
    expect(migration).toContain(
      "IN ('rating', 'private_feedback', 'destination_action', 'qualified_scan')",
    )
    for (const prohibited of [
      'ip_address',
      'session_id',
      'response_id',
      'rating_id',
      'feedback_id',
      'destination_id',
      'staff_participant_id',
      'content',
      'comment',
    ]) {
      const table = migration.slice(
        migration.indexOf('CREATE TABLE "guest_network_pressure_records"'),
        migration.indexOf(
          ');',
          migration.indexOf('CREATE TABLE "guest_network_pressure_records"'),
        ),
      )
      expect(table).not.toContain(`"${prohibited}"`)
    }
  })

  it('does not import globally derived legacy hashes and clears every old copy', () => {
    expect(migration).not.toContain('INSERT INTO guest_network_pressure_records')
    expect(migration).not.toContain('guest_qualified_scan_receipts')
    for (const table of ['scan_events', 'ratings', 'feedback']) {
      expect(migration).toContain(`UPDATE ${table} SET ip_hash = NULL`)
    }
  })

  it('owns only journal slot 0142', () => {
    expect(
      journal.entries
        .filter(({ idx }) => idx === 142)
        .map(({ idx, tag }) => ({ idx, tag })),
    ).toEqual([{ idx: 142, tag: '0142_guest_network_pressure' }])
  })
})

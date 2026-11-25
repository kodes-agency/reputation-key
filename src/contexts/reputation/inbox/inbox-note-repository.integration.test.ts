// Inbox context — inbox note repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.
//
// This file previously mocked `db` with a chain whose `where()` discarded its
// arguments, so deleting the `organizationId` conjunct from
// `findByInboxItemId` passed the whole suite (review §2.1). A mock that
// swallows the predicate cannot fail; the predicate is only provable against a
// real database that actually withholds the other tenant's row. The
// cross-tenant reads below are the load-bearing assertions.

import { beforeEach, describe, it, expect } from 'vitest'
import { createInboxNoteRepository } from './inbox-note-repository.server'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { InboxNote } from '#/contexts/reputation/domain/inbox-types'

const ORG_A = organizationId('org-inbox-note-aaaa-1111')
const ORG_B = organizationId('org-inbox-note-bbbb-2222')
const PROP_A = propertyId('4a000000-0000-4000-8000-00000000000a')
const PROP_B = propertyId('4b000000-0000-4000-8000-00000000000b')
const USER_A = userId('user-inbox-note-aaaa-1111')
const USER_B = userId('user-inbox-note-bbbb-2222')

// inbox_notes.inbox_item_id references inbox_items(id) alone — NOT a composite
// (organization_id, id) key. So a note row can legally point at an item owned
// by another tenant, and nothing but the repository's own organizationId
// conjunct keeps ORG_B from reading ORG_A's notes on a shared item id.
const ITEM_A = inboxItemId('4c000000-0000-4000-8000-00000000000c')
const ITEM_A2 = inboxItemId('4d000000-0000-4000-8000-00000000000d')
const ITEM_B = inboxItemId('4e000000-0000-4000-8000-00000000000e')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['inbox_notes', 'inbox_items'],
})

async function seedItem(id: string, orgId: string, propId: string): Promise<void> {
  await getPool().query(
    `INSERT INTO inbox_items (id, organization_id, property_id, source_type, source_id, status, source_date)
     VALUES ($1, $2, $3, 'review', gen_random_uuid(), 'open', NOW())
     ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
    [id, orgId, propId],
  )
}

async function insertNote(note: InboxNote): Promise<InboxNote> {
  await getPool().query(
    `INSERT INTO inbox_notes (id, inbox_item_id, organization_id, author_user_id, text)
     VALUES ($1, $2, $3, $4, $5)`,
    [note.id, note.inboxItemId, note.organizationId, note.userId, note.text],
  )
  return note
}

function makeNote(overrides: Partial<InboxNote> = {}): InboxNote {
  return {
    id: inboxNoteId(crypto.randomUUID()),
    inboxItemId: ITEM_A,
    organizationId: ORG_A,
    userId: USER_A,
    text: 'internal staff note',
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(async () => {
  await seedItem(ITEM_A, ORG_A, PROP_A)
  await seedItem(ITEM_A2, ORG_A, PROP_A)
  await seedItem(ITEM_B, ORG_B, PROP_B)
})

describe('inboxNoteRepository (integration)', () => {
  describe('findByInboxItemId', () => {
    it('returns the notes for the item, newest first', async () => {
      const repo = createInboxNoteRepository(getDb())
      const older = await insertNote(makeNote({ text: 'first' }))
      // createdAt is DB-assigned; separate the two writes so desc() is decidable.
      await getPool().query(
        `UPDATE inbox_notes SET created_at = created_at - INTERVAL '1 hour' WHERE id = $1`,
        [older.id],
      )
      const newer = await insertNote(makeNote({ text: 'second' }))

      const found = await repo.findByInboxItemId(ITEM_A, ORG_A)

      expect(found.map((n) => n.text)).toEqual(['second', 'first'])
      expect(found.map((n) => n.id)).toEqual([newer.id, older.id])
    })

    it('withholds another tenant notes on the same inbox item', async () => {
      const repo = createInboxNoteRepository(getDb())
      // ORG_A's own note on its own item.
      await insertNote(makeNote({ text: 'ORG_A private note' }))
      // A note ORG_B legitimately owns, hung off the item ORG_B owns.
      await insertNote(
        makeNote({
          inboxItemId: ITEM_B,
          organizationId: ORG_B,
          userId: USER_B,
          text: 'ORG_B private note',
        }),
      )

      // ORG_B asks for the notes on ORG_A's item. The FK does not stop it —
      // only the organizationId conjunct does.
      const leaked = await repo.findByInboxItemId(ITEM_A, ORG_B)
      expect(leaked).toEqual([])

      // ...and symmetrically, ORG_A cannot read ORG_B's item.
      const leakedOther = await repo.findByInboxItemId(ITEM_B, ORG_A)
      expect(leakedOther).toEqual([])

      // Each tenant still sees exactly its own note.
      expect((await repo.findByInboxItemId(ITEM_A, ORG_A)).map((n) => n.text)).toEqual([
        'ORG_A private note',
      ])
      expect((await repo.findByInboxItemId(ITEM_B, ORG_B)).map((n) => n.text)).toEqual([
        'ORG_B private note',
      ])
    })

    it('withholds a foreign tenant note attached to the caller own item', async () => {
      const repo = createInboxNoteRepository(getDb())
      // ORG_B's note pointed at ORG_A's item — the shape the FK permits.
      // Written through the pool, like every note in this file.
      const foreignNoteId = crypto.randomUUID()
      await getPool().query(
        `INSERT INTO inbox_notes (id, inbox_item_id, organization_id, author_user_id, text)
         VALUES ($1, $2, $3, $4, 'ORG_B note on ORG_A item')`,
        [foreignNoteId, ITEM_A, ORG_B, USER_B],
      )
      const own = await insertNote(makeNote({ text: 'ORG_A note' }))

      const found = await repo.findByInboxItemId(ITEM_A, ORG_A)

      expect(found.map((n) => n.id)).toEqual([own.id])
      expect(found.map((n) => n.organizationId)).toEqual([ORG_A])
    })

    it('does not bleed notes across inbox items of the same tenant', async () => {
      const repo = createInboxNoteRepository(getDb())
      await insertNote(makeNote({ inboxItemId: ITEM_A, text: 'on item A' }))
      await insertNote(makeNote({ inboxItemId: ITEM_A2, text: 'on item A2' }))

      expect((await repo.findByInboxItemId(ITEM_A, ORG_A)).map((n) => n.text)).toEqual([
        'on item A',
      ])
      expect((await repo.findByInboxItemId(ITEM_A2, ORG_A)).map((n) => n.text)).toEqual([
        'on item A2',
      ])
    })

    it('returns an empty list for an item that has no notes', async () => {
      const repo = createInboxNoteRepository(getDb())
      expect(await repo.findByInboxItemId(ITEM_A2, ORG_A)).toEqual([])
    })
  })
})

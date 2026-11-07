import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { runErasureJournalCommand } from './erasure-journal-export'
import { decodeErasureJournalExport } from '../../src/shared/db/lifecycle/erasure-journal.server'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true })
})
it('exports to a private local file without overwriting prior evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'erasure-journal-'))
  directories.push(directory)
  const output = join(directory, 'journal.json')
  const bucket = { readEntries: async () => [], ensureExpiry: async () => {} }
  await runErasureJournalCommand(['--output', output], {}, () => bucket)
  expect(decodeErasureJournalExport(await readFile(output, 'utf8')).entries).toEqual([])
  expect((await stat(output)).mode & 0o777).toBe(0o600)
  await writeFile(output, 'prior evidence')
  await expect(
    runErasureJournalCommand(['--output', output], {}, () => bucket),
  ).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(output, 'utf8')).toBe('prior evidence')
})
it('refuses bucket access from an isolated verifier process before constructing a client', async () => {
  let constructed = false
  await expect(
    runErasureJournalCommand(
      ['--output', '/tmp/unused'],
      { RESTORE_MODE: 'isolated' },
      () => {
        constructed = true
        throw new Error('must not construct')
      },
    ),
  ).rejects.toThrow('isolated')
  expect(constructed).toBe(false)
})

it('replays an exported pre-delete intent against an earlier tenant snapshot idempotently', async () => {
  const { applyRestoreResurrectionFence } =
    await import('../../src/shared/db/lifecycle/backup-erasure-ledger')
  const { createGuestBackupErasureReplayer } =
    await import('../../src/contexts/guest/infrastructure/adapters/guest-backup-erasure-replayer.adapter')
  const directory = await mkdtemp(join(tmpdir(), 'erasure-replay-'))
  directories.push(directory)
  const output = join(directory, 'journal.json')
  const entry = {
    id: '30000000-0000-4000-8000-00000000000a',
    recordedBeforeErasure: true as const,
    subjectClass: 'organization' as const,
    organizationId: 'org-erased',
    context: 'guest' as const,
    closureLineageId: '30000000-0000-4000-8000-000000000001',
    lifecycleRevision: 1,
    effectiveErasureAt: new Date('2026-11-07T12:00:00.000Z'),
    erasedRowCount: 2,
    evidenceRef: 'guest:purge:batch-1',
  }
  await runErasureJournalCommand(['--output', output], {}, () => ({
    readEntries: async () => [entry],
    ensureExpiry: async () => {},
  }))
  const snapshot = new Map([
    ['org-erased', 2],
    ['org-other', 3],
  ])
  const replayer = createGuestBackupErasureReplayer({
    countUndeliveredGuestFacts: async () => 0,
    countTenantRows: async (_tx, org) => snapshot.get(org) ?? 0,
    scrubTenantRows: async (_tx, org) => {
      snapshot.delete(org)
    },
  })
  const tx = {} as import('../../src/shared/outbox/commit').Tx
  const input = {
    entries: decodeErasureJournalExport(await readFile(output, 'utf8')).entries,
    restorePointAt: new Date('2026-11-07T12:00:01.000Z'),
    replayers: [replayer],
  }
  expect((await applyRestoreResurrectionFence(tx, input)).counts.ledgerRowsReErased).toBe(
    2,
  )
  expect(snapshot.has('org-erased')).toBe(false)
  expect(snapshot.get('org-other')).toBe(3)
  expect((await applyRestoreResurrectionFence(tx, input)).counts.ledgerRowsReErased).toBe(
    0,
  )
})

it('validates all arguments before constructing a bucket client', async () => {
  for (const argv of [
    [],
    ['--apply'],
    ['--output'],
    ['--output', 'file', '--apply'],
    ['expiry', '--invalid'],
  ]) {
    let constructed = false
    await expect(
      runErasureJournalCommand(argv, {}, () => {
        constructed = true
        throw new Error('must not construct')
      }),
    ).rejects.toThrow('usage:')
    expect(constructed).toBe(false)
  }
})

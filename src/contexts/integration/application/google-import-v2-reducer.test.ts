import { describe, expect, it } from 'vitest'
import type { GbpImportItemStatus, ImportOutcomeCode } from './google-import-v2-contract'
import { reduceGoogleImportParent } from './google-import-v2-reducer'

type Item = Readonly<{
  status: GbpImportItemStatus
  outcomeCode: ImportOutcomeCode | null
  highestAttemptForRevision: number
}>

const at = new Date('2026-08-12T12:00:00.000Z')
const terminalAt = new Date('2026-08-11T12:00:00.000Z')

function item(
  status: GbpImportItemStatus,
  outcomeCode: ImportOutcomeCode | null = null,
  highestAttemptForRevision = 0,
): Item {
  return { status, outcomeCode, highestAttemptForRevision }
}

describe('reduceGoogleImportParent', () => {
  it('distinguishes untouched queued work from work that has already claimed an attempt', () => {
    expect(
      reduceGoogleImportParent({
        items: [item('pending'), item('pending')],
        firstTerminalAt: null,
        now: at,
      }),
    ).toMatchObject({ status: 'queued', firstTerminalAt: null, purgeAt: null })

    expect(
      reduceGoogleImportParent({
        items: [item('pending', null, 1), item('pending')],
        firstTerminalAt: null,
        now: at,
      }),
    ).toMatchObject({ status: 'processing', firstTerminalAt: null, purgeAt: null })
  })

  it('is processing while any claimed, pending, or processing item remains', () => {
    const reduced = reduceGoogleImportParent({
      items: [item('processing', null, 1), item('imported', 'imported', 1)],
      firstTerminalAt: null,
      now: at,
    })

    expect(reduced).toMatchObject({
      status: 'processing',
      processedCount: 1,
      counts: { pending: 0, processing: 1, imported: 1 },
      firstTerminalAt: null,
      purgeAt: null,
    })
  })

  it.each([
    {
      name: 'only successful imports',
      items: [item('imported', 'imported'), item('relinked', 'relinked')],
      status: 'completed',
    },
    {
      name: 'only cancellations',
      items: [
        item('cancelled', 'authorization_changed'),
        item('cancelled', 'property_deleted'),
      ],
      status: 'cancelled',
    },
    {
      name: 'only true failures',
      items: [
        item('failed', 'active_binding_conflict'),
        item('failed', 'temporarily_unavailable'),
      ],
      status: 'failed',
    },
    {
      name: 'only benign skip',
      items: [item('already_exists', 'already_exists')],
      status: 'completed_with_issues',
    },
    {
      name: 'success plus failure',
      items: [item('imported', 'imported'), item('failed', 'stale_binding')],
      status: 'completed_with_issues',
    },
    {
      name: 'benign skip plus cancellation',
      items: [
        item('already_exists', 'already_exists'),
        item('cancelled', 'organization_suspended'),
      ],
      status: 'completed_with_issues',
    },
  ])('reduces $name exhaustively', ({ items, status }) => {
    expect(
      reduceGoogleImportParent({ items, firstTerminalAt: null, now: at }),
    ).toMatchObject({ status, processedCount: items.length })
  })

  it('sets the terminal and purge clocks once, then preserves them when retry reopens', () => {
    const first = reduceGoogleImportParent({
      items: [item('failed', 'temporarily_unavailable', 5)],
      firstTerminalAt: null,
      now: at,
    })
    expect(first.firstTerminalAt).toEqual(at)
    expect(first.purgeAt).toEqual(new Date('2026-09-11T12:00:00.000Z'))

    const reopened = reduceGoogleImportParent({
      items: [item('pending', null, 0)],
      firstTerminalAt: first.firstTerminalAt,
      now: new Date('2026-08-13T12:00:00.000Z'),
    })
    expect(reopened).toMatchObject({
      status: 'processing',
      firstTerminalAt: at,
      purgeAt: new Date('2026-09-11T12:00:00.000Z'),
    })

    const terminalAgain = reduceGoogleImportParent({
      items: [item('imported', 'imported', 1)],
      firstTerminalAt: terminalAt,
      now: at,
    })
    expect(terminalAgain.firstTerminalAt).toEqual(terminalAt)
    expect(terminalAgain.purgeAt).toEqual(new Date('2026-09-10T12:00:00.000Z'))
  })

  it('rejects malformed status/outcome pairs instead of reducing corrupt rows', () => {
    expect(() =>
      reduceGoogleImportParent({
        items: [item('failed', 'imported')],
        firstTerminalAt: null,
        now: at,
      }),
    ).toThrow('invalid import item status/outcome pair')
  })
})

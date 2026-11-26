import { describe, expect, it } from 'vitest'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import {
  SOURCE_UNAVAILABLE_CLOSE_REASONS,
  assertManagerHandlingPermitted,
  assertManualReopenPermitted,
} from './handling-outcome-authority'
import type { HandlingCycleHead } from './inbox-types'

const ITEM = inboxItemId('8a000000-0000-4000-8000-000000000001')
const ORG = organizationId('org-handling-outcome-authority-01')
const PROPERTY = propertyId('8a000000-0000-4000-8000-000000000002')
const FEEDBACK = feedbackId('8a000000-0000-4000-8000-000000000003')

const head = (overrides: Partial<HandlingCycleHead> = {}): HandlingCycleHead => ({
  inboxItemId: ITEM,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceType: 'feedback',
  sourceId: FEEDBACK,
  currentCycleNumber: 1,
  currentSourceRevision: 1,
  stateRevision: 1,
  status: 'open',
  ...overrides,
})

describe('SOURCE_UNAVAILABLE_CLOSE_REASONS', () => {
  it('names exactly the retention, redaction and source-unavailable closures', () => {
    expect([...SOURCE_UNAVAILABLE_CLOSE_REASONS]).toEqual([
      'guest_withdrawn',
      'source_ineligible',
    ])
  })
})

describe('assertManagerHandlingPermitted', () => {
  it('permits an open private-feedback cycle whose source has never been unavailable', () => {
    const decision = assertManagerHandlingPermitted({
      current: head(),
      recordedCloseReasons: ['superseded_by_source_revision'],
    })
    expect(decision.isOk()).toBe(true)
  })

  it('refuses after a guest withdrawal even once the cycle has been reopened', () => {
    const decision = assertManagerHandlingPermitted({
      current: head({ currentCycleNumber: 2, currentSourceRevision: 1, status: 'open' }),
      recordedCloseReasons: ['guest_withdrawn'],
    })
    expect(decision.isErr()).toBe(true)
    if (!decision.isErr()) return
    expect(decision.error.code).toBe('invalid_transition')
    expect(decision.error.context).toMatchObject({
      unavailableCloseReasons: ['guest_withdrawn'],
    })
  })

  it('refuses after a retention purge or redaction closed the source as ineligible', () => {
    const decision = assertManagerHandlingPermitted({
      current: head({ currentCycleNumber: 3, status: 'open' }),
      recordedCloseReasons: ['superseded_by_source_revision', 'source_ineligible'],
    })
    expect(decision.isErr()).toBe(true)
    if (!decision.isErr()) return
    expect(decision.error.context).toMatchObject({
      unavailableCloseReasons: ['source_ineligible'],
    })
  })

  it('reports every unavailability reason it saw rather than only the first', () => {
    const decision = assertManagerHandlingPermitted({
      current: head(),
      recordedCloseReasons: ['guest_withdrawn', 'source_ineligible', 'guest_withdrawn'],
    })
    expect(decision.isErr()).toBe(true)
    if (!decision.isErr()) return
    expect(decision.error.context).toMatchObject({
      unavailableCloseReasons: ['guest_withdrawn', 'source_ineligible'],
    })
  })

  it('refuses a manager outcome on a Review cycle regardless of its history', () => {
    const decision = assertManagerHandlingPermitted({
      current: head({
        sourceType: 'review',
        sourceId: reviewId('8a000000-0000-4000-8000-000000000004'),
      }),
      recordedCloseReasons: [],
    })
    expect(decision.isErr()).toBe(true)
    if (!decision.isErr()) return
    expect(decision.error.code).toBe('invalid_input')
  })
})

describe('assertManualReopenPermitted', () => {
  it('permits reopening a closed private-feedback cycle whose source is still live', () => {
    const decision = assertManualReopenPermitted({
      current: head({ status: 'closed' }),
      recordedCloseReasons: ['private_feedback_handled'],
    })
    expect(decision.isOk()).toBe(true)
  })

  it('refuses to reopen once the guest withdrew: the cycle could never close', () => {
    const decision = assertManualReopenPermitted({
      current: head({ status: 'closed' }),
      recordedCloseReasons: ['guest_withdrawn'],
    })
    expect(decision.isErr()).toBe(true)
    if (!decision.isErr()) return
    expect(decision.error.code).toBe('invalid_transition')
    expect(decision.error.context).toMatchObject({
      unavailableCloseReasons: ['guest_withdrawn'],
    })
  })

  it('refuses after a purge or redaction made the source ineligible, even cycles later', () => {
    const decision = assertManualReopenPermitted({
      current: head({ currentCycleNumber: 3, status: 'closed' }),
      recordedCloseReasons: ['superseded_by_source_revision', 'source_ineligible'],
    })
    expect(decision.isErr()).toBe(true)
  })

  it('leaves Review cycles to their own reopen rules', () => {
    const decision = assertManualReopenPermitted({
      current: head({
        sourceType: 'review',
        sourceId: reviewId('8a000000-0000-4000-8000-000000000004'),
        status: 'closed',
      }),
      recordedCloseReasons: ['source_ineligible'],
    })
    expect(decision.isOk()).toBe(true)
  })
})

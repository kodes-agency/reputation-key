// BQC-3.9 — per-family durable cutover flag tests.
//
// The cutover flags drive the phase BQC-3 §7 migration states per inbox
// projection family:
//   record-only — facts recorded to the outbox; the in-process bus stays the
//                 primary projection path (today's production posture);
//   shadow      — BOTH paths run (durable dispatcher must be on) and the
//                 harness compares projection outcomes without content;
//   switch      — the durable path is primary; the family's bus handlers are
//                 NOT registered (legacy path retired for that family).
//
// Env encoding (simplest honest form — no JSON):
//   DURABLE_CUTOVER_INBOX                       group default for all four
//   DURABLE_CUTOVER_INBOX_REVIEW_CREATED        per-family override
//   DURABLE_CUTOVER_INBOX_REVIEW_UPDATED        per-family override
//   DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED        per-family override
//   DURABLE_CUTOVER_INBOX_REVIEW_REPLY_PUBLISHED per-family override
// Precedence: per-family var > group var > 'record-only'. An unrecognized
// non-empty value fails closed (throw) — a typo'd cutover flag must never
// silently resolve to a state the operator did not ask for.

import { describe, it, expect } from 'vitest'
import {
  INBOX_CUTOVER_FAMILIES,
  cutoverEnvVarFor,
  resolveCutoverState,
  listActiveCutoverFamilies,
} from './cutover-flags'

describe('cutover flags (BQC-3.9)', () => {
  it('declares the four inbox projection families', () => {
    expect([...INBOX_CUTOVER_FAMILIES]).toEqual([
      'review.created',
      'review.updated',
      'review.expired',
      'review.reply.published',
    ])
  })

  it('maps each family to its per-family env var name', () => {
    expect(cutoverEnvVarFor('review.created')).toBe(
      'DURABLE_CUTOVER_INBOX_REVIEW_CREATED',
    )
    expect(cutoverEnvVarFor('review.updated')).toBe(
      'DURABLE_CUTOVER_INBOX_REVIEW_UPDATED',
    )
    expect(cutoverEnvVarFor('review.expired')).toBe(
      'DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED',
    )
    expect(cutoverEnvVarFor('review.reply.published')).toBe(
      'DURABLE_CUTOVER_INBOX_REVIEW_REPLY_PUBLISHED',
    )
  })

  it('defaults every family to record-only when no env is set', () => {
    for (const family of INBOX_CUTOVER_FAMILIES) {
      expect(resolveCutoverState(family, {})).toBe('record-only')
    }
    expect(listActiveCutoverFamilies({})).toEqual([])
  })

  it('applies the group var DURABLE_CUTOVER_INBOX to every family', () => {
    const env = { DURABLE_CUTOVER_INBOX: 'shadow' }
    for (const family of INBOX_CUTOVER_FAMILIES) {
      expect(resolveCutoverState(family, env)).toBe('shadow')
    }
    expect(listActiveCutoverFamilies(env)).toEqual(
      INBOX_CUTOVER_FAMILIES.map((family) => ({ family, state: 'shadow' })),
    )
  })

  it('lets a per-family var override the group var', () => {
    const env = {
      DURABLE_CUTOVER_INBOX: 'shadow',
      DURABLE_CUTOVER_INBOX_REVIEW_CREATED: 'switch',
    }
    expect(resolveCutoverState('review.created', env)).toBe('switch')
    expect(resolveCutoverState('review.expired', env)).toBe('shadow')
  })

  it('a per-family record-only override wins over a group shadow', () => {
    const env = {
      DURABLE_CUTOVER_INBOX: 'shadow',
      DURABLE_CUTOVER_INBOX_REVIEW_EXPIRED: 'record-only',
    }
    expect(resolveCutoverState('review.expired', env)).toBe('record-only')
    expect(listActiveCutoverFamilies(env)).toEqual([
      { family: 'review.created', state: 'shadow' },
      { family: 'review.updated', state: 'shadow' },
      { family: 'review.reply.published', state: 'shadow' },
    ])
  })

  it('parses case-insensitively and ignores surrounding whitespace', () => {
    expect(
      resolveCutoverState('review.created', {
        DURABLE_CUTOVER_INBOX_REVIEW_CREATED: '  Switch ',
      }),
    ).toBe('switch')
  })

  it('treats an empty per-family value as unset (falls through to group/default)', () => {
    const env = { DURABLE_CUTOVER_INBOX_REVIEW_CREATED: '   ' }
    expect(resolveCutoverState('review.created', env)).toBe('record-only')
  })

  it('fails closed on an unrecognized value', () => {
    expect(() =>
      resolveCutoverState('review.created', {
        DURABLE_CUTOVER_INBOX_REVIEW_CREATED: 'shadw',
      }),
    ).toThrow(/DURABLE_CUTOVER_INBOX_REVIEW_CREATED/)
    expect(() =>
      resolveCutoverState('review.created', { DURABLE_CUTOVER_INBOX: 'on' }),
    ).toThrow(/DURABLE_CUTOVER_INBOX/)
  })
})

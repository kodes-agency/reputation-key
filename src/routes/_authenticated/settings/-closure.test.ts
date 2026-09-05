// LIF-01-T17 — Closure Center UI contract.
//
// The `-` prefix keeps this file out of the route tree.
//
// This repository has no React testing-library dependency and the `unit`
// Vitest project only collects `*.test.ts`, so the RENDERED assertions live in
// `closure-center.stories.tsx` play functions (deadline timezone, disabled
// reactivate button, absent password field, visible checksum) and run in the
// storybook browser project. What belongs HERE is everything that can be
// proved without a DOM and must not be allowed to drift silently: the honesty
// of every state label, the timezone-bound deadline formatter, the exact
// projection the server sends, and the untouched capability posture.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listBlockedCapabilities } from '#/shared/auth/beta-capabilities'
import { ORGANIZATION_LIFECYCLE_STATES } from '#/contexts/identity/domain/organization-lifecycle'
import {
  CLOSURE_STATE_COPY,
  formatDeadline,
} from '#/components/features/closure/closure-status-card'
import { REACTIVATION_ACTIONS } from '#/components/features/closure/reactivation-checklist'
import { closureConfirmationPhrase } from '#/contexts/identity/application/dto/organization-closure.dto'

const CLOSURE_ROOT = join(process.cwd(), 'src/components/features/closure')
const read = (file: string) => readFileSync(join(CLOSURE_ROOT, file), 'utf8')

describe('Closure Center state honesty', () => {
  it('gives every one of the six lifecycle states its own label and description', () => {
    const labels = ORGANIZATION_LIFECYCLE_STATES.map(
      (state) => CLOSURE_STATE_COPY[state].label,
    )

    expect(Object.keys(CLOSURE_STATE_COPY).sort()).toEqual(
      [...ORGANIZATION_LIFECYCLE_STATES].sort(),
    )
    expect(new Set(labels).size).toBe(ORGANIZATION_LIFECYCLE_STATES.length)
  })

  it('never describes an irreversible state as recoverable', () => {
    for (const state of ['purge_pending', 'purging', 'closed'] as const) {
      expect(CLOSURE_STATE_COPY[state].reversible, state).toBe(false)
      expect(CLOSURE_STATE_COPY[state].tone, state).toBe('destructive')
    }
    expect(CLOSURE_STATE_COPY.purging.description).toContain('cannot be stopped')
    expect(CLOSURE_STATE_COPY.closed.description).toContain('permanently deleted')
    expect(CLOSURE_STATE_COPY.closing.description).toContain('Nothing has been deleted')
  })

  it("renders the recovery deadline in the Organization's timezone, not the browser's", () => {
    // 13:30 UTC is 09:30 in the cell's civil time. A browser-local render is a
    // different hour, and near midnight a different DAY — which on this page
    // means believing there is still time when there is not.
    const rendered = formatDeadline('2026-09-27T13:30:00.000Z', 'America/New_York')

    expect(rendered).toContain('September 27, 2026')
    expect(rendered).toContain('9:30 AM')
    expect(rendered).toContain('EDT')
    expect(formatDeadline(null, 'America/New_York')).toBe('—')
    expect(formatDeadline('not-a-date', 'America/New_York')).toBe('—')
  })
})

describe('Closure Center posture (program bullet 8)', () => {
  /**
   * The constraint restated as an assertion: adding the Closure Center must
   * not change the capability posture at all.
   */
  it('leaves BLOCKED_CAPABILITIES byte-equal', () => {
    expect(listBlockedCapabilities()).toEqual([
      'gbp.ai.cross_property_summary',
      'gbp.reply.auto_publish',
      'gbp.review_solicitation_gamification',
      'identity.custom_roles',
      'identity.register',
      'organization.create',
      'portal.guest_contact',
      'portal.guest_media',
      'portal.upload',
      'property.erase',
    ])
  })

  it.each([
    'closure-center.tsx',
    'closure-status-card.tsx',
    'organization-export-panel.tsx',
    'reactivation-checklist.tsx',
  ])('adds no authentication factor in %s', (file) => {
    const source = read(file)
      // Strip comments so the prose explaining the constraint cannot satisfy it.
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/^\s*\/\/.*$/gmu, '')

    expect(source).not.toMatch(/type=["']password["']/u)
    expect(source).not.toMatch(/one-time-code/u)
    expect(source).not.toMatch(/\b(mfa|totp|stepUp|step_up|reauthenticate)\b/iu)
    expect(source).not.toMatch(/\b(two-factor|authenticator|verification code)\b/iu)
  })

  it('gates the closure request on typed confirmation only', () => {
    const source = read('closure-center.tsx')

    expect(source).toContain('confirmationMatches')
    expect(closureConfirmationPhrase('Harbour Group')).toBe('CLOSE Harbour Group')
  })
})

describe('Closure Center disclosure limits', () => {
  it('never references an object key, token digest or evidence reference', () => {
    for (const file of [
      'closure-center.tsx',
      'closure-status-card.tsx',
      'organization-export-panel.tsx',
    ]) {
      const source = read(file)
      expect(source, file).not.toMatch(/\bobjectKey\b/u)
      expect(source, file).not.toMatch(/\bretrievalTokenDigest\b/u)
      expect(source, file).not.toMatch(/\bencryptionEvidenceRef\b/u)
    }
    // `supportEvidenceRef` appears only as the tenant's OWN input on the
    // request form — never as a rendered value from the lifecycle authority.
    expect(read('closure-status-card.tsx')).not.toContain('supportEvidenceRef')
    expect(read('organization-export-panel.tsx')).not.toContain('supportEvidenceRef')
  })

  it('does render coverage and archive checksums, which are how a tenant verifies', () => {
    const source = read('organization-export-panel.tsx')

    expect(source).toContain('coverageSha256')
    expect(source).toContain('archiveSha256')
  })
})

describe('Reactivation checklist', () => {
  it('models the three deliberate actions as confirmations, never as operations', () => {
    expect(REACTIVATION_ACTIONS.map((action) => action.id)).toEqual([
      'portal_republished',
      'ai_capability_reviewed',
      'google_reauthorized',
    ])
    for (const action of REACTIVATION_ACTIONS) {
      // Past tense: the reader confirms what they already did elsewhere.
      expect(action.label.startsWith('I '), action.id).toBe(true)
    }
  })

  it('states that reactivation performs none of them', () => {
    const source = read('reactivation-checklist.tsx')

    expect(source).toContain('Reactivation never does this for you')
    expect(source).toContain('never performs any of them')
  })
})

describe('Closure Center visual regression coverage', () => {
  it('covers every lifecycle state and the four export states', () => {
    const stories = read('closure-center.stories.tsx')

    for (const story of [
      'export const Active',
      'export const ClosureRequested',
      'export const Closing',
      'export const PurgePending',
      'export const Purging',
      'export const Closed',
      'export const AwaitingReactivation',
      'export const ExportRequested',
      'export const ExportGenerating',
      'export const ExportReady',
      'export const ExportExpired',
    ]) {
      expect(stories, story).toContain(story)
    }
  })
})

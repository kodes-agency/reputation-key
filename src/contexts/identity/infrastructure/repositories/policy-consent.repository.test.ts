// BQC-2.2 — policy/consent records integration test (real PostgreSQL).
//
// Generic governed consent state needed by enabled features now and AI
// opt-in later (phase BQC-2 §2.2; §9 forbids building the AI flows — only
// the governed state). Proves record/revoke/read semantics, one active
// consent per (org, subject, purpose), and expiry handling.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  recordPolicyConsent,
  revokePolicyConsent,
  getActiveConsent,
} from './policy-consent.repository'

const db = getDb()
const ORG = 'org-consent'
const HOUR = 60 * 60 * 1000

beforeAll(async () => {
  await db.execute(sql`DELETE FROM policy_consent WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Consent Org', ${ORG}, now())`,
  )
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM policy_consent WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('policy consent records (BQC-2.2)', () => {
  it('records and reads an active consent', async () => {
    const consent = await recordPolicyConsent(db, {
      organizationId: ORG,
      subjectType: 'property',
      subjectId: 'prop-consent-1',
      purpose: 'ai.analyze',
      recordedBy: 'user-admin-1',
    })
    expect(consent.id).toBeTruthy()
    expect(consent.state).toBe('granted')

    const active = await getActiveConsent(db, {
      organizationId: ORG,
      subjectType: 'property',
      subjectId: 'prop-consent-1',
      purpose: 'ai.analyze',
      at: new Date(),
    })
    expect(active?.id).toBe(consent.id)
  })

  it('rejects a second active consent for the same (org, subject, purpose)', async () => {
    await expect(
      recordPolicyConsent(db, {
        organizationId: ORG,
        subjectType: 'property',
        subjectId: 'prop-consent-1',
        purpose: 'ai.analyze',
      }),
    ).rejects.toThrow()
  })

  it('revokes, then allows a fresh record', async () => {
    const revoked = await revokePolicyConsent(db, {
      organizationId: ORG,
      subjectType: 'property',
      subjectId: 'prop-consent-1',
      purpose: 'ai.analyze',
    })
    expect(revoked).toBe(true)
    await expect(
      getActiveConsent(db, {
        organizationId: ORG,
        subjectType: 'property',
        subjectId: 'prop-consent-1',
        purpose: 'ai.analyze',
        at: new Date(),
      }),
    ).resolves.toBeNull()

    const fresh = await recordPolicyConsent(db, {
      organizationId: ORG,
      subjectType: 'property',
      subjectId: 'prop-consent-1',
      purpose: 'ai.analyze',
    })
    expect(fresh.state).toBe('granted')
  })

  it('treats expired consent as inactive', async () => {
    await recordPolicyConsent(db, {
      organizationId: ORG,
      subjectType: 'organization',
      subjectId: ORG,
      purpose: 'ai.generate_reply',
      expiresAt: new Date(Date.now() - HOUR),
    })
    await expect(
      getActiveConsent(db, {
        organizationId: ORG,
        subjectType: 'organization',
        subjectId: ORG,
        purpose: 'ai.generate_reply',
        at: new Date(),
      }),
    ).resolves.toBeNull()
  })

  it('rejects unknown purposes and subjects at the CHECK constraints', async () => {
    await expect(
      recordPolicyConsent(db, {
        organizationId: ORG,
        subjectType: 'galaxy',
        subjectId: 'x',
        purpose: 'ai.analyze',
      }),
    ).rejects.toThrow()
  })
})

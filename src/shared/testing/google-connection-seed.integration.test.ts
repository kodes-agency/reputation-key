import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import { setupIntegrationDb } from './integration-helpers'
import { seedGoogleConnection } from './google-connection-seed'

const ORG_A = organizationId(`org-google-seed-a-${randomUUID()}`)
const ORG_B = organizationId(`org-google-seed-b-${randomUUID()}`)

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['google_connections'],
})

const row = async (id: string) =>
  (
    await getPool().query(
      `SELECT organization_id, google_subject, encrypted_access_token, connected_by,
              visibility, status, credential_use_state, scopes,
              token_expires_at > now() AS live
         FROM google_connections WHERE id = $1`,
      [id],
    )
  ).rows[0]

describe('seedGoogleConnection', () => {
  it('writes an active, organization-visible connection with live tokens', async () => {
    const { connectionId } = await seedGoogleConnection(getPool(), {
      organizationId: ORG_A,
    })

    expect(await row(connectionId)).toMatchObject({
      organization_id: ORG_A,
      status: 'active',
      credential_use_state: 'active',
      visibility: 'organization',
      connected_by: 'seed-user',
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      live: true,
    })
  })

  it('keeps the id, status, credential state and subject it is given', async () => {
    const id = randomUUID()
    const { connectionId } = await seedGoogleConnection(getPool(), {
      id,
      organizationId: ORG_A,
      googleSubject: `subject-${id}`,
      status: 'reauth_required',
      credentialUseState: 'cleanup_only',
    })

    expect(connectionId).toBe(id)
    expect(await row(id)).toMatchObject({
      google_subject: `subject-${id}`,
      status: 'reauth_required',
      credential_use_state: 'cleanup_only',
    })
  })

  it('adopts the surviving connection for a subject instead of colliding', async () => {
    const googleSubject = `subject-${randomUUID()}`
    const first = await seedGoogleConnection(getPool(), {
      organizationId: ORG_A,
      googleSubject,
      status: 'reauth_required',
      accessToken: 'old',
    })

    const second = await seedGoogleConnection(getPool(), {
      organizationId: ORG_A,
      googleSubject,
      accessToken: 'new',
      adoptExistingSubject: true,
    })

    expect(second.connectionId).toBe(first.connectionId)
    expect(await row(first.connectionId)).toMatchObject({
      status: 'active',
      encrypted_access_token: 'new',
    })
  })

  it('refuses a second connection for the same subject unless told to adopt', async () => {
    const googleSubject = `subject-${randomUUID()}`
    await seedGoogleConnection(getPool(), { organizationId: ORG_A, googleSubject })

    await expect(
      seedGoogleConnection(getPool(), { organizationId: ORG_A, googleSubject }),
    ).rejects.toThrow(/google_connections_google_subject/)
  })
})

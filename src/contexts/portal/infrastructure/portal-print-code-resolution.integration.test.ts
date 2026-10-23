// A print code finds its Portal on real PostgreSQL (ADR 0069): the page lookup and
// the scan lookup each take the short digest beside the long one, under the same
// statement and the same rules. No minting exists yet, so every code row here is
// inserted with its two print code hashes written directly, as the codec derives
// them. The long address is the control throughout: it must resolve as it always did.

import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { portalAccessArtifactId, portalId, propertyId } from '#/shared/domain/ids'
import { organizationId } from '#/shared/domain/ids'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildLegacyPortalPublicationSnapshot } from '../application/__fixtures__/legacy-snapshot-builder'
import type { PresentedAddressDigest } from '../application/ports/portal-token-codec.port'
import { createPortalTokenCodec } from './adapters/portal-token-codec'
import { createPortalAccessArtifactRepository } from './repositories/portal-access-artifact.repository'
import { createPortalGroupRepository } from './repositories/portal-group.repository'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'

const ORG = organizationId('org-print-resolution-00000000001')
const OTHER_ORG = organizationId('org-print-resolution-00000000002')
const T0 = new Date('2026-10-23T09:00:00.000Z')
const NOW = new Date(T0.getTime() + 60 * 60 * 1000)
const DAY_MS = 24 * 60 * 60 * 1000

const codec = createPortalTokenCodec({
  secret: 'print-code-resolution-secret-0123456789',
  randomBytes,
})

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_group_memberships',
    'portal_access_artifacts',
    'portal_tokens',
    'portal_groups',
    'portals',
    'properties',
  ],
})

type Scope = Readonly<{ org: string; property: string; portal: string; snapshot: string }>
type CodeRow = Readonly<{
  tokenId: string
  rawToken: string
  qr: Readonly<{ artifactId: string; printCode: string }>
  nfc: Readonly<{ artifactId: string; printCode: string }>
}>
type RowState = Readonly<{
  version?: number
  status?: 'active' | 'rotating' | 'revoked'
  gracePeriodEnds?: Date
}>

/** A Portal with one published snapshot live since T0, in its own Property. */
async function seedPortal(org: string): Promise<Scope> {
  const scope = {
    org,
    property: randomUUID(),
    portal: randomUUID(),
    snapshot: randomUUID(),
  }
  const slug = `print-${scope.portal.slice(0, 8)}`
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Print code property', $3, 'UTC')`,
    [scope.property, org, slug],
  )
  await getPool().query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                          name, slug, publication_state, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, 'Print code portal', $5, 'published',
             'manager-print-code', $6, $6)`,
    [scope.portal, org, scope.property, scope.property, slug, T0],
  )
  const snapshot = buildLegacyPortalPublicationSnapshot({
    id: scope.snapshot,
    portalId: portalId(scope.portal),
    organizationId: organizationId(org),
    propertyId: propertyId(scope.property),
    version: 1,
    source: {
      portal: {
        id: scope.portal,
        name: 'Print code portal',
        slug,
        description: null,
        heroImageUrl: null,
        theme: null,
        organizationName: 'Print code organization',
      },
      categories: [],
      links: [],
      privateFeedbackThreshold: 3,
      organizationId: organizationId(org),
      propertyId: propertyId(scope.property),
    },
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=print-code',
      retrievedAt: T0,
      sourceEpoch: 1,
      profileVersion: 1,
    },
    createdBy: 'manager-print-code',
    createdAt: T0,
  })
  await getDb().insert(portalPublicationSnapshots).values({
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
    portalId: snapshot.portalId,
    version: snapshot.version,
    configurationDigest: snapshot.configurationDigest,
    configuration: snapshot.configuration,
    guestLocale: snapshot.configuration.guestLocale,
    languagePackVersion: snapshot.configuration.languagePackVersion,
    privateFeedbackThreshold:
      snapshot.configuration.reviewGateway.privateFeedbackThreshold,
    destinationUri: snapshot.destinationUri,
    destinationRetrievedAt: snapshot.destinationRetrievedAt,
    destinationSourceEpoch: snapshot.destinationSourceEpoch,
    destinationProfileVersion: snapshot.destinationProfileVersion,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
  })
  await getDb().insert(portalPublicationActivations).values({
    id: randomUUID(),
    organizationId: org,
    propertyId: scope.property,
    portalId: scope.portal,
    snapshotId: scope.snapshot,
    activationSequence: 1,
    kind: 'publish',
    activatedBy: 'manager-print-code',
    activatedAt: T0,
  })
  return scope
}

/** A code row with both print code hashes and a published QR and NFC artifact. */
async function seedCodeRow(scope: Scope, state: RowState = {}): Promise<CodeRow> {
  const { status = 'active', version = 1, gracePeriodEnds } = state
  const tokenId = randomUUID()
  const artifacts = { qr: randomUUID(), nfc: randomUUID() }
  const issued = codec.issue()
  const printCodes = codec.derivePrintCodes({
    rawToken: issued.rawToken,
    accessArtifactIds: artifacts,
  })
  if (!printCodes) throw new Error('the codec did not derive print codes')
  const retired = status === 'active' ? null : (gracePeriodEnds ?? NOW)
  await getPool().query(
    `INSERT INTO portal_tokens
       (id, organization_id, property_id, portal_id, token_identifier, token_hash,
        token_key_version, version, status, issued_at, grace_period_ends, retired_at,
        revoked_at, qr_print_code_hash, nfc_print_code_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      tokenId,
      scope.org,
      scope.property,
      scope.portal,
      issued.tokenIdentifier,
      issued.tokenHash,
      issued.tokenKeyVersion,
      version,
      status,
      new Date(T0.getTime() - DAY_MS),
      status === 'rotating' ? retired : null,
      retired,
      status === 'revoked' ? retired : null,
      printCodes.qr.printCodeHash,
      printCodes.nfc.printCodeHash,
    ],
  )
  for (const channel of ['qr', 'nfc'] as const) {
    await getPool().query(
      `INSERT INTO portal_access_artifacts
         (id, organization_id, property_id, portal_id, portal_token_id, channel,
          status, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7)`,
      [artifacts[channel], scope.org, scope.property, scope.portal, tokenId, channel, T0],
    )
  }
  return {
    tokenId,
    rawToken: issued.rawToken,
    qr: { artifactId: artifacts.qr, printCode: printCodes.qr.printCode },
    nfc: { artifactId: artifacts.nfc, printCode: printCodes.nfc.printCode },
  }
}

const digestOf = (raw: string): PresentedAddressDigest => {
  const digest = codec.digest(raw)
  if (!digest) throw new Error(`not an address: ${raw}`)
  return digest
}

const pages = () => createPortalPublicationRepository(getDb())
const artifacts = () =>
  createPortalAccessArtifactRepository(getDb(), createPortalGroupRepository(getDb()))
const after = (date: Date, ms: number) => new Date(date.getTime() + ms)

/** The scan lookup as the guest asks it: no marker unless one is named. */
const scanOf = (
  scope: Scope,
  address: string,
  patch: Partial<Parameters<ReturnType<typeof artifacts>['resolvePublished']>[0]> = {},
) =>
  artifacts().resolvePublished({
    accessArtifactId: null,
    organizationId: organizationId(scope.org),
    propertyId: propertyId(scope.property),
    portalId: portalId(scope.portal),
    publicationSnapshotId: scope.snapshot,
    tokenDigest: digestOf(address),
    asOf: NOW,
    ...patch,
  })

const marker = (id: string) => portalAccessArtifactId(id)

describe.sequential('a print code opens the page (real PostgreSQL)', () => {
  it('opens the live publication by either channel code, in any case', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)

    for (const code of [row.qr.printCode, row.nfc.printCode.toLowerCase()]) {
      await expect(
        pages().resolveActiveByTokenDigest(digestOf(code), NOW),
      ).resolves.toMatchObject({
        token: {
          organizationId: ORG,
          propertyId: scope.property,
          portalId: scope.portal,
        },
        snapshot: { id: scope.snapshot },
      })
    }
  })

  it('opens the same row by its long address, which resolves as it always did', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)

    const long = await pages().resolveActiveByTokenDigest(digestOf(row.rawToken), NOW)
    const short = await pages().resolveActiveByTokenDigest(
      digestOf(row.qr.printCode),
      NOW,
    )
    expect(long).not.toBeNull()
    expect(short).toEqual(long)
  })

  it('finds nothing for a code nobody printed, as for an unknown long address', async () => {
    const scope = await seedPortal(ORG)
    await seedCodeRow(scope)

    await expect(
      pages().resolveActiveByTokenDigest(digestOf('0123456789ABCDEFGHJK'), NOW),
    ).resolves.toBeNull()
    await expect(
      pages().resolveActiveByTokenDigest(digestOf(codec.issue().rawToken), NOW),
    ).resolves.toBeNull()
  })

  it('opens through the grace period of a replaced code, up to its last instant', async () => {
    const scope = await seedPortal(ORG)
    const graceEnds = after(NOW, 30 * DAY_MS)
    const old = await seedCodeRow(scope, {
      status: 'rotating',
      gracePeriodEnds: graceEnds,
    })
    const lookup = (code: string, at: Date) =>
      pages().resolveActiveByTokenDigest(digestOf(code), at)

    await expect(lookup(old.qr.printCode, after(graceEnds, -1))).resolves.not.toBeNull()
    // The page boundary is inclusive: it opens at the exact instant grace ends.
    await expect(lookup(old.qr.printCode, graceEnds)).resolves.not.toBeNull()
    await expect(lookup(old.nfc.printCode, graceEnds)).resolves.not.toBeNull()
    await expect(lookup(old.qr.printCode, after(graceEnds, 1))).resolves.toBeNull()
    await expect(lookup(old.rawToken, after(graceEnds, 1))).resolves.toBeNull()
  })

  it('stops opening when the row is stopped, or its security replacement ended grace', async () => {
    const scope = await seedPortal(ORG)
    const stopped = await seedCodeRow(scope, { status: 'revoked', version: 1 })
    const replaced = await seedCodeRow(scope, {
      status: 'rotating',
      version: 2,
      gracePeriodEnds: NOW,
    })

    for (const row of [stopped, replaced]) {
      for (const code of [row.qr.printCode, row.nfc.printCode, row.rawToken]) {
        await expect(
          pages().resolveActiveByTokenDigest(digestOf(code), after(NOW, 1)),
        ).resolves.toBeNull()
      }
    }
  })

  it.each([
    ['the Portal is deleted', `UPDATE portals SET deleted_at = $1 WHERE id = $2`],
    [
      'the Portal is disabled',
      `UPDATE portals SET publication_state = 'disabled', updated_at = $1 WHERE id = $2`,
    ],
  ])('stops opening when %s', async (_name, statement) => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)
    await expect(
      pages().resolveActiveByTokenDigest(digestOf(row.qr.printCode), NOW),
    ).resolves.not.toBeNull()

    await getPool().query(statement, [after(NOW, -1000), scope.portal])

    await expect(
      pages().resolveActiveByTokenDigest(digestOf(row.qr.printCode), NOW),
    ).resolves.toBeNull()
    await expect(
      pages().resolveActiveByTokenDigest(digestOf(row.rawToken), NOW),
    ).resolves.toBeNull()
  })

  it('stops opening when the publication is switched off', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)
    await getPool().query(
      `UPDATE portal_publication_activations
          SET deactivated_at = $1, deactivation_reason = 'disabled'
        WHERE portal_id = $2`,
      [after(NOW, -1000), scope.portal],
    )

    await expect(
      pages().resolveActiveByTokenDigest(digestOf(row.nfc.printCode), NOW),
    ).resolves.toBeNull()
  })

  it('does not open a row that has no print codes yet by anything but its long address', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)
    await getPool().query(
      `UPDATE portal_tokens SET qr_print_code_hash = NULL, nfc_print_code_hash = NULL
        WHERE id = $1`,
      [row.tokenId],
    )

    await expect(
      pages().resolveActiveByTokenDigest(digestOf(row.qr.printCode), NOW),
    ).resolves.toBeNull()
    await expect(
      pages().resolveActiveByTokenDigest(digestOf(row.rawToken), NOW),
    ).resolves.not.toBeNull()
  })
})

describe.sequential('a print code counts a scan (real PostgreSQL)', () => {
  it('names the artifact from the code alone, and its channel from the column that matched', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)

    await expect(scanOf(scope, row.qr.printCode)).resolves.toMatchObject({
      accessArtifactId: row.qr.artifactId,
      channel: 'qr',
      organizationId: ORG,
      portalId: scope.portal,
      portalGroupId: null,
    })
    await expect(scanOf(scope, row.nfc.printCode.toLowerCase())).resolves.toMatchObject({
      accessArtifactId: row.nfc.artifactId,
      channel: 'nfc',
    })
  })

  it('accepts a claimed marker only when it is the artifact the code names', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)

    await expect(
      scanOf(scope, row.qr.printCode, { accessArtifactId: marker(row.qr.artifactId) }),
    ).resolves.toMatchObject({ accessArtifactId: row.qr.artifactId, channel: 'qr' })
    // The other channel's artifact of the same row is not the one this code names.
    await expect(
      scanOf(scope, row.qr.printCode, { accessArtifactId: marker(row.nfc.artifactId) }),
    ).resolves.toBeNull()
    await expect(
      scanOf(scope, row.nfc.printCode, { accessArtifactId: marker(row.qr.artifactId) }),
    ).resolves.toBeNull()
    await expect(
      scanOf(scope, row.qr.printCode, { accessArtifactId: marker(randomUUID()) }),
    ).resolves.toBeNull()
  })

  it('cannot claim another code row’s artifact, in this Portal or in another Organization', async () => {
    const scope = await seedPortal(ORG)
    const own = await seedCodeRow(scope, { version: 1 })
    const sibling = await seedCodeRow(scope, { version: 2 })
    const foreignScope = await seedPortal(OTHER_ORG)
    const foreign = await seedCodeRow(foreignScope)

    for (const other of [sibling, foreign]) {
      for (const artifactId of [other.qr.artifactId, other.nfc.artifactId]) {
        await expect(
          scanOf(scope, own.qr.printCode, { accessArtifactId: marker(artifactId) }),
        ).resolves.toBeNull()
      }
    }
    await expect(scanOf(scope, sibling.qr.printCode)).resolves.toMatchObject({
      accessArtifactId: sibling.qr.artifactId,
    })
  })

  it('is refused under another Portal, Property, Organization or publication', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)
    const otherPortal = await seedPortal(ORG)
    const foreign = await seedPortal(OTHER_ORG)
    const here = {
      organizationId: organizationId(scope.org),
      propertyId: propertyId(scope.property),
      portalId: portalId(scope.portal),
    }

    await expect(scanOf(scope, row.qr.printCode, here)).resolves.not.toBeNull()
    for (const patch of [
      { portalId: portalId(otherPortal.portal) },
      { propertyId: propertyId(otherPortal.property) },
      { organizationId: organizationId(foreign.org) },
      { publicationSnapshotId: otherPortal.snapshot },
      { publicationSnapshotId: randomUUID() },
    ]) {
      await expect(scanOf(scope, row.qr.printCode, patch)).resolves.toBeNull()
    }
  })

  it('finds nothing for a code nobody printed', async () => {
    const scope = await seedPortal(ORG)
    await seedCodeRow(scope)

    await expect(scanOf(scope, '0123456789ABCDEFGHJK')).resolves.toBeNull()
  })

  it('counts through grace and stops at its last instant, one instant before the page does', async () => {
    const scope = await seedPortal(ORG)
    const graceEnds = after(NOW, 30 * DAY_MS)
    const old = await seedCodeRow(scope, {
      status: 'rotating',
      gracePeriodEnds: graceEnds,
    })

    await expect(
      scanOf(scope, old.qr.printCode, { asOf: after(graceEnds, -1) }),
    ).resolves.toMatchObject({ channel: 'qr' })
    // A counted scan needs the code strictly inside grace: at the exact instant it
    // ends the page still opens (the test above) but the visit is not counted.
    await expect(scanOf(scope, old.qr.printCode, { asOf: graceEnds })).resolves.toBeNull()
    await expect(
      scanOf(scope, old.nfc.printCode, { asOf: graceEnds }),
    ).resolves.toBeNull()
    await expect(
      scanOf(scope, old.qr.printCode, { asOf: after(graceEnds, 1) }),
    ).resolves.toBeNull()
  })

  it('stops counting when the code is stopped or its security replacement ended grace', async () => {
    const scope = await seedPortal(ORG)
    const stopped = await seedCodeRow(scope, { status: 'revoked', version: 1 })
    const replaced = await seedCodeRow(scope, {
      status: 'rotating',
      version: 2,
      gracePeriodEnds: NOW,
    })

    for (const row of [stopped, replaced]) {
      for (const code of [row.qr.printCode, row.nfc.printCode]) {
        await expect(scanOf(scope, code, { asOf: after(NOW, 1) })).resolves.toBeNull()
      }
    }
  })

  it('stops counting when the artifact is retired, or the Portal is deleted or disabled', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)
    await expect(scanOf(scope, row.qr.printCode)).resolves.not.toBeNull()

    await getPool().query(
      `UPDATE portal_access_artifacts SET status = 'retired', retired_at = $1 WHERE id = $2`,
      [after(NOW, -1000), row.qr.artifactId],
    )
    await expect(scanOf(scope, row.qr.printCode)).resolves.toBeNull()
    // Only that artifact: the NFC code of the same row keeps counting.
    await expect(scanOf(scope, row.nfc.printCode)).resolves.not.toBeNull()

    await getPool().query(`UPDATE portals SET deleted_at = $1 WHERE id = $2`, [
      after(NOW, -1000),
      scope.portal,
    ])
    await expect(scanOf(scope, row.nfc.printCode)).resolves.toBeNull()
  })

  it('takes the group of the Portal at the time, and refuses a group of another Property', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)
    const group = randomUUID()
    const foreignProperty = (await seedPortal(ORG)).property
    const foreignGroup = randomUUID()
    await getPool().query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name)
       VALUES ($1, $3, $4, 'Same Property'), ($2, $3, $5, 'Another Property')`,
      [group, foreignGroup, ORG, scope.property, foreignProperty],
    )
    const member = (property: string, groupId: string, from: Date, to: Date | null) =>
      getPool().query(
        `INSERT INTO portal_group_memberships
           (organization_id, property_id, portal_id, portal_group_id, effective_from,
            effective_to, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'manager-print-code')`,
        [ORG, property, scope.portal, groupId, from, to],
      )
    await member(scope.property, group, T0, after(NOW, 10_000))
    await member(foreignProperty, foreignGroup, after(NOW, 10_000), null)

    await expect(scanOf(scope, row.qr.printCode)).resolves.toMatchObject({
      portalGroupId: group,
    })
    // The same lookup, later: the Portal's group now belongs to another Property.
    await expect(
      scanOf(scope, row.qr.printCode, { asOf: after(NOW, 20_000) }),
    ).resolves.toBeNull()
  })

  it('never counts a long address that carries no marker, and does not query for it', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)

    // The row has a published QR and NFC artifact, and still names nothing.
    await expect(scanOf(scope, row.rawToken)).resolves.toBeNull()

    const untouched = new Proxy(
      {},
      {
        get: () => {
          throw new Error('a long address with no marker reached the database')
        },
      },
    ) as ReturnType<typeof getDb>
    await expect(
      createPortalAccessArtifactRepository(
        untouched,
        createPortalGroupRepository(untouched),
      ).resolvePublished({
        accessArtifactId: null,
        organizationId: organizationId(scope.org),
        propertyId: propertyId(scope.property),
        portalId: portalId(scope.portal),
        publicationSnapshotId: scope.snapshot,
        tokenDigest: digestOf(row.rawToken),
        asOf: NOW,
      }),
    ).resolves.toBeNull()
  })

  it('counts a long address that carries its marker exactly as before', async () => {
    const scope = await seedPortal(ORG)
    const row = await seedCodeRow(scope)

    await expect(
      scanOf(scope, row.rawToken, { accessArtifactId: marker(row.qr.artifactId) }),
    ).resolves.toMatchObject({ accessArtifactId: row.qr.artifactId, channel: 'qr' })
    await expect(
      scanOf(scope, row.rawToken, { accessArtifactId: marker(row.nfc.artifactId) }),
    ).resolves.toMatchObject({ accessArtifactId: row.nfc.artifactId, channel: 'nfc' })
    await expect(
      scanOf(scope, row.rawToken, { accessArtifactId: marker(randomUUID()) }),
    ).resolves.toBeNull()
  })
})

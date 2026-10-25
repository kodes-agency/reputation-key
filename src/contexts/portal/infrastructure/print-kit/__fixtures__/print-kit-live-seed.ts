// The live print kit a Portal has, over real PostgreSQL: the scenario's working
// copy published with Bulgarian first, a code sealed by the real cipher with its
// two markers, and real pictures in the object store. Shared by today's print
// kit's integration test and the final kit's, which each call
// `setupIntegrationDb` with `PRINT_KIT_INTEGRATION_TABLES` and pass its pool.

import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import sharp from 'sharp'
import type { StoragePort } from '../../../application/ports/storage.port'
import { bulgarianPrimaryConfiguration } from '../../../domain/__fixtures__/immersive-configuration'
import { createPortalAddressCipher } from '../../adapters/portal-address-cipher'
import {
  COMPLETE_SCENARIO,
  SCENARIO_HERO_ASSET,
} from '../../testing/portal-working-copy-scenarios'

export const BASE_URL = 'https://app.example.test'
export const PRINT_ORIGIN = 'https://ap.example.test'
export const RAW_TOKEN = 'pt_AAAAAAAAAAAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
export const TOKEN_ID = 'c6000000-0000-4000-8000-000000000001'
export const QR_MARKER = 'c7000000-0000-4000-8000-000000000001'
export const NFC_MARKER = 'c7000000-0000-4000-8000-000000000002'
export const KEYRING = `1:${'ab'.repeat(32)}`
export const LOGO_ASSET = 'c5000000-0000-4000-8000-000000000002'

/** The tables a print kit's integration test empties between tests. */
export const PRINT_KIT_INTEGRATION_TABLES = [
  'portal_address_downloads',
  'portal_last_prints',
  'portal_access_artifacts',
  'portal_tokens',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_localized_overrides',
  'property_portal_brand_contents',
  'property_portal_brand_profiles',
  'portal_link_texts',
  'portal_links',
  'portal_media_assets',
  'portal_approved_destinations',
  'portal_link_categories',
  'outbox_events',
  'portals',
  'properties',
]

export const sha256Hex = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

/** Stores a real picture under an asset the seed made, and makes its row say so. */
export async function storePrintKitPicture(
  pool: Pool,
  store: Pick<StoragePort, 'putObject'>,
  assetId: string,
  size: Readonly<{ width: number; height: number }>,
): Promise<void> {
  const body = await sharp({
    create: { ...size, channels: 3, background: '#557766' },
  })
    .webp()
    .toBuffer()
  await store.putObject(`portal-media/${assetId}.webp`, body, 'image/webp')
  await pool.query(
    `UPDATE portal_media_assets SET byte_size = $2, content_sha256 = $3 WHERE id = $1::uuid`,
    [assetId, body.length, sha256Hex(body)],
  )
}

let sealed = 0

export const printKitCipher = createPortalAddressCipher({
  keyring: KEYRING,
  // A fresh IV per seal, as the cipher requires; deterministic, as test data may be.
  generateIv: () =>
    createHash('sha256')
      .update(`print-kit-iv-${(sealed += 1)}`)
      .digest()
      .subarray(0, 12),
})

/** What the live version published: Bulgarian first, with the look the scenario's working copy has. */
export const printKitLiveConfiguration = (
  localeSet: readonly ('bg' | 'en')[] = ['bg', 'en'],
) => {
  const base = bulgarianPrimaryConfiguration()
  const own = (value: string) => ({ value, fallbackFrom: null }) as const
  const content = (title: string) => ({
    title: own(title),
    shortDescription: own(title),
    heroAlt: own(title),
    linktreeTitle: own(title),
  })
  return bulgarianPrimaryConfiguration({
    portal: { id: COMPLETE_SCENARIO.portalId, slug: COMPLETE_SCENARIO.slug },
    localeSet,
    languagePackVersions: Object.fromEntries(
      localeSet.map((locale) => [locale, base.languagePackVersions[locale]]),
    ),
    localizedContent: Object.fromEntries(
      localeSet.map((locale) => [
        locale,
        content(locale === 'bg' ? 'Хотел Рила' : 'Hotel Rila Lobby'),
      ]),
    ),
    links: base.links.map((link) => ({
      ...link,
      texts: Object.fromEntries(
        localeSet.flatMap((locale) => {
          const text = link.texts[locale]
          return text ? [[locale, text]] : []
        }),
      ),
    })),
    brandProfile: {
      ...base.brandProfile,
      wordmark: 'RILA',
      logo: { assetId: LOGO_ASSET, width: 480, height: 120 },
      hero: {
        assetId: SCENARIO_HERO_ASSET,
        width: 1600,
        height: 1000,
        focalX: 0.3,
        focalY: 0.7,
      },
    },
  })
}

/** A live code: the token row sealed by the real cipher, and its two markers. */
export async function seedPrintKitCode(pool: Pool, sealed: boolean): Promise<void> {
  const {
    organizationId: org,
    propertyId: property,
    portalId: portal,
  } = COMPLETE_SCENARIO
  const address = sealed
    ? printKitCipher.seal(RAW_TOKEN, {
        organizationId: org,
        propertyId: property,
        portalId: portal,
        tokenId: TOKEN_ID,
        version: 1,
      })
    : null
  await pool.query(
    `INSERT INTO portal_tokens (
       id, organization_id, property_id, portal_id, token_identifier, token_hash,
       encrypted_raw_token, address_encryption_key_version, version, status,
       issued_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'active', now(), now())`,
    [
      TOKEN_ID,
      org,
      property,
      portal,
      RAW_TOKEN.slice(0, 19),
      sha256Hex(Buffer.from(RAW_TOKEN)),
      address?.ciphertext ?? null,
      address?.keyVersion ?? null,
    ],
  )
  for (const [channel, id] of [
    ['qr', QR_MARKER],
    ['nfc', NFC_MARKER],
  ] as const) {
    await pool.query(
      `INSERT INTO portal_access_artifacts (
         id, organization_id, property_id, portal_id, portal_token_id, channel, status,
         published_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'published', now())`,
      [id, org, property, portal, TOKEN_ID, channel],
    )
  }
}

// Portal context: the zod shape of a schema version 3 (Immersive Hub)
// publication configuration, as stored in `portal_publication_snapshots`.
//
// The snapshot digest is recomputed over the zod-parsed object, and zod strips
// keys it does not name. Every field of the v3 shape is therefore named here,
// and adding a guest-visible one later needs a v4 (ADR 0061). Structural
// completeness (packs, fallbacks, limits) is the verifier's job, not this
// schema's: this only refuses what cannot be typed.

import { z } from 'zod/v4'
import { GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { guestLocaleSchema } from '#/shared/guest-locale-schemas'

const snapshotTextSchema = z
  .object({ value: z.string(), fallbackFrom: guestLocaleSchema.nullable() })
  .readonly()

const localizedContentSchema = z
  .object({
    title: snapshotTextSchema,
    shortDescription: snapshotTextSchema,
    heroAlt: snapshotTextSchema,
    linktreeTitle: snapshotTextSchema,
  })
  .readonly()

const linkTextSchema = z
  .object({
    label: z.string(),
    line: z.string().nullable(),
    fallbackFrom: guestLocaleSchema.nullable(),
  })
  .readonly()

const linkSchema = z
  .object({
    id: z.string().min(1),
    url: z.url({ protocol: /^https$/u }),
    iconKey: z.string().nullable(),
    imageAssetId: z.string().nullable(),
    texts: z.partialRecord(guestLocaleSchema, linkTextSchema).readonly(),
  })
  .readonly()

const mediaSchema = z
  .object({ assetId: z.string(), width: z.number(), height: z.number() })
  .readonly()

const heroSchema = z
  .object({
    assetId: z.string(),
    width: z.number(),
    height: z.number(),
    focalX: z.number(),
    focalY: z.number(),
  })
  .readonly()

const brandProfileSchema = z
  .object({
    displayName: z.string(),
    wordmark: z.string().nullable(),
    logo: mediaSchema.nullable(),
    hero: heroSchema.nullable(),
    accentColour: z.string(),
    fieldColour: z.string(),
    lookVersion: z.number().int(),
  })
  .readonly()

/** Everything a v3 configuration has beyond the review gateway facts every version shares. */
export const immersiveConfigurationFields = {
  schemaVersion: z.literal(3),
  portal: z.object({ id: z.string().min(1), slug: z.string().min(1) }).readonly(),
  guestLocale: guestLocaleSchema,
  languagePackVersion: z.string(),
  localeSet: z.array(guestLocaleSchema).min(1).max(GUEST_LOCALES.length).readonly(),
  languagePackVersions: z.partialRecord(guestLocaleSchema, z.string()).readonly(),
  localizedContent: z.partialRecord(guestLocaleSchema, localizedContentSchema).readonly(),
  linktree: z.object({ enabled: z.boolean() }).readonly(),
  links: z.array(linkSchema).readonly(),
  brandProfile: brandProfileSchema,
  timeZone: z.string(),
  provenance: z
    .object({ aiDraftTextKeys: z.array(z.string()).readonly() })
    .readonly()
    .optional(),
}

import { z } from 'zod/v4'
import type { EventDescriptor } from './descriptor'
import { additionalGuestLocalesSchema, guestLocaleSchema } from '../guest-locale-schemas'
import {
  portalApprovedDestinationRatioRecordedV1Schema,
  portalApprovedDestinationRatioRecordedV2Schema,
  portalConfigurationCompletenessRecordedV1Schema,
  portalConfigurationCompletenessRecordedV2Schema,
  portalConfigurationCompletenessRecordedV3Schema,
  portalContentReviewCompletedV1Schema,
  portalContentReviewCompletedV2Schema,
} from './portal-workflow-event-schemas'

// ── Portal event schemas ───────────────────────────────────────────

const portalLifecycleFactSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalCreatedSchema = portalLifecycleFactSchema.extend({
  publicationState: z.enum(['draft', 'published', 'disabled', 'archived']),
})

const portalUpdatedSchema = portalCreatedSchema.extend({
  previousPublicationState: z.enum(['draft', 'published', 'disabled', 'archived']),
})

const portalActorLifecycleFactSchema = portalLifecycleFactSchema.extend({
  userId: z.string().trim().min(1),
})

const portalPublicationFactSchema = portalActorLifecycleFactSchema.extend({
  publicationSnapshotId: z.string().trim().min(1),
  publicationVersion: z.number().int().safe().positive(),
  publicationDigest: z.string().regex(/^[0-9a-f]{64}$/u),
})

const portalDeletedSchema = portalLifecycleFactSchema

const portalResponsibilityNeededV1Schema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  occurredAt: z.iso.datetime(),
})

const portalResponsibilityNeededV2Schema = portalLifecycleFactSchema.extend({
  // Whose action opened the gap; see the Property fact.
  actorUserId: z.string().nullable().optional(),
})

const portalResponsibleManagersUpdatedSchema = portalLifecycleFactSchema.extend({
  assignmentCount: z.number().int().nonnegative(),
})

const portalHealthStatusSchema = z.enum(['healthy', 'degraded', 'unavailable'])
const portalHealthReasonSchema = z.enum([
  'operational',
  'publication_draft',
  'publication_disabled',
  'publication_archived',
  'property_unavailable',
  'publication_snapshot_unavailable',
  'public_address_unavailable',
  'responsibility_needed',
  'google_destination_awaiting_refresh',
  'google_destination_unavailable',
])
const portalHealthChangedSchema = z.object({
  portalId: z.string().min(1),
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  previousStatus: portalHealthStatusSchema,
  previousReason: portalHealthReasonSchema,
  status: portalHealthStatusSchema,
  reason: portalHealthReasonSchema,
  sourceVersion: z.string().trim().min(1).max(160),
  occurredAt: z.iso.datetime(),
})

const portalPropertyFactSchema = z.object({
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})
const portalPropertyBrandProfileUpdatedSchema = portalPropertyFactSchema.extend({
  profileVersion: z.number().int().positive(),
})
const portalPropertyBrandContentUpdatedSchema = portalPropertyFactSchema.extend({
  guestLocale: guestLocaleSchema,
  contentVersion: z.number().int().positive(),
})
const portalLocalizedOverrideUpdatedSchema = portalLifecycleFactSchema.extend({
  guestLocale: guestLocaleSchema,
  overrideVersion: z.number().int().positive().nullable(),
})
const portalLocaleSetUpdatedSchema = portalLifecycleFactSchema.extend({
  primaryGuestLocale: guestLocaleSchema,
  additionalGuestLocales: additionalGuestLocalesSchema,
})
const portalApprovedDestinationUpdatedSchema = portalPropertyFactSchema.extend({
  approvedDestinationId: z.uuid(),
  approvalState: z.enum(['pending', 'approved', 'disabled', 'quarantined']),
})

const portalTokenIssuedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  tokenIdentifier: z.string(),
  version: z.number().int().positive(),
  sourceAggregateVersion: z.iso.datetime().optional(),
  occurredAt: z.iso.datetime().optional(),
})

const portalTokenRotatedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  previousVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  gracePeriodEnds: z.iso.datetime(),
  sourceAggregateVersion: z.iso.datetime().optional(),
  occurredAt: z.iso.datetime().optional(),
})

const portalTokenRevokedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime().optional(),
  occurredAt: z.iso.datetime().optional(),
})

const portalAccessArtifactPublishedSchema = portalLifecycleFactSchema.extend({
  accessArtifactId: z.uuid(),
  channel: z.enum(['qr', 'nfc']),
})

const portalGroupDeletedV1Schema = z.object({
  portalGroupId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
})

const portalGroupDeletedV2Schema = portalGroupDeletedV1Schema.extend({
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalGroupCreatedSchema = z.object({
  portalGroupId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalAddedToGroupSchema = z.object({
  portalGroupId: z.string(),
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalGroupUpdatedSchema = portalGroupCreatedSchema

const portalRemovedFromGroupSchema = portalAddedToGroupSchema

const portalLinkCategoryCreatedSchema = z.object({
  portalId: z.string(),
  categoryId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalLinkCategoryReorderedSchema = z.object({
  portalId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalLinkCategoryUpdatedSchema = portalLinkCategoryCreatedSchema
const portalLinkCategoryDeletedSchema = portalLinkCategoryCreatedSchema

const portalLinkCreatedSchema = z.object({
  portalId: z.string(),
  linkId: z.string(),
  categoryId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalLinkReorderedSchema = z.object({
  portalId: z.string(),
  categoryId: z.string(),
  organizationId: z.string(),
  propertyId: z.string(),
  sourceAggregateVersion: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
})

const portalLinkUpdatedSchema = portalLinkCreatedSchema
const portalLinkDeletedSchema = portalLinkCreatedSchema

export const portalEventDescriptors = [
  {
    type: 'portal.created',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalCreatedSchema,
  },
  {
    type: 'portal.updated',
    aggregate: { type: 'portal', id: 'portalId' },
    version: 1,
    schema: portalUpdatedSchema,
  },
  {
    type: 'portal.publication.published',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalPublicationFactSchema,
  },
  {
    type: 'portal.publication.rolled_back',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalPublicationFactSchema,
  },
  {
    type: 'portal.archived',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalActorLifecycleFactSchema,
  },
  {
    type: 'portal.restored',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalActorLifecycleFactSchema,
  },
  {
    type: 'portal.deleted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalDeletedSchema,
  },
  {
    type: 'portal.responsibility_became_needed',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalResponsibilityNeededV1Schema,
  },
  {
    type: 'portal.responsibility_became_needed',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    schema: portalResponsibilityNeededV2Schema,
  },
  {
    type: 'portal.responsible_managers.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    schema: portalResponsibleManagersUpdatedSchema,
  },
  {
    type: 'portal.health.changed',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalHealthChangedSchema,
  },
  {
    type: 'portal.property_brand_profile.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalPropertyBrandProfileUpdatedSchema,
  },
  {
    type: 'portal.property_brand_content.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalPropertyBrandContentUpdatedSchema,
  },
  {
    type: 'portal.localized_override.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLocalizedOverrideUpdatedSchema,
  },
  {
    type: 'portal.locale_set.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLocaleSetUpdatedSchema,
  },
  {
    type: 'portal.approved_destination.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalApprovedDestinationUpdatedSchema,
  },
  {
    type: 'portal.content_review.completed',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: portalContentReviewCompletedV1Schema,
  },
  {
    type: 'portal.content_review.completed',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 2,
    schema: portalContentReviewCompletedV2Schema,
  },
  {
    type: 'portal.configuration_completeness.recorded',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: portalConfigurationCompletenessRecordedV1Schema,
  },
  {
    type: 'portal.configuration_completeness.recorded',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 2,
    schema: portalConfigurationCompletenessRecordedV2Schema,
  },
  {
    type: 'portal.configuration_completeness.recorded',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 3,
    emits: (event) => event.fieldSet === 'immersive_hub',
    schema: portalConfigurationCompletenessRecordedV3Schema,
  },
  {
    type: 'portal.approved_destination_ratio.recorded',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 1,
    schema: portalApprovedDestinationRatioRecordedV1Schema,
  },
  {
    type: 'portal.approved_destination_ratio.recorded',
    aggregate: { type: 'review', id: 'reviewId' },
    version: 2,
    schema: portalApprovedDestinationRatioRecordedV2Schema,
  },
  {
    type: 'portal.token.issued',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalTokenIssuedSchema,
  },
  {
    type: 'portal.token.rotated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalTokenRotatedSchema,
  },
  {
    type: 'portal.token.revoked',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalTokenRevokedSchema,
  },
  {
    type: 'portal.access_artifact.published',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalAccessArtifactPublishedSchema,
  },
  {
    type: 'portal_link_category.created',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLinkCategoryCreatedSchema,
  },
  {
    type: 'portal_link_category.reordered',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLinkCategoryReorderedSchema,
  },
  {
    type: 'portal_link_category.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLinkCategoryUpdatedSchema,
  },
  {
    type: 'portal_link_category.deleted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLinkCategoryDeletedSchema,
  },
  {
    type: 'portal_link.created',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLinkCreatedSchema,
  },
  {
    type: 'portal_link.reordered',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLinkReorderedSchema,
  },
  {
    type: 'portal_link.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLinkUpdatedSchema,
  },
  {
    type: 'portal_link.deleted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalLinkDeletedSchema,
  },
  {
    type: 'portal_group.created',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalGroupCreatedSchema,
  },
  {
    type: 'portal_group.updated',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalGroupUpdatedSchema,
  },
  {
    type: 'portal_group.portal_added',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalAddedToGroupSchema,
  },
  {
    type: 'portal_group.portal_removed',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalRemovedFromGroupSchema,
  },
  {
    type: 'portal_group.deleted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 1,
    schema: portalGroupDeletedV1Schema,
  },
  {
    type: 'portal_group.deleted',
    aggregate: { type: 'property', id: 'propertyId' },
    version: 2,
    schema: portalGroupDeletedV2Schema,
  },
] as const satisfies readonly EventDescriptor[]

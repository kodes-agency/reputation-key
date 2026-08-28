// LIF-01-T20 — the port every context implements to answer a privacy request.
//
// One contributor per context that can hold a subject's data. The four
// operations mirror the four request kinds, and each one is scoped to
// (organizationId, propertyId, subjectRef) — a contributor that ignores any
// part of that triple is a cross-tenant read waiting to happen, which is why
// the scope is one value rather than three parameters.
//
// `resolve` exists separately from `access` because refusing a cross-tenant or
// cross-property lookup must happen BEFORE any data is gathered, not while it
// is being assembled.

import type { Tx } from '#/shared/outbox/commit'
import type { PrivacyRequestKind, PrivacySubjectType } from './privacy-request'

export type PrivacySubjectScope = Readonly<{
  organizationId: string
  propertyId: string
  subjectType: PrivacySubjectType
  /** SHA-256 of the VERIFIED subject identifier. */
  subjectRef: string
}>

/** Classification of one section of an access package. */
export type PrivacyPackageClassification = 'content_free' | 'personal' | 'sensitive'

export type PrivacyPackageSection = Readonly<{
  context: string
  table: string
  classification: PrivacyPackageClassification
  /** The subject's own rows, already scoped. Never another subject's. */
  records: readonly Readonly<Record<string, unknown>>[]
}>

export type PrivacyCorrectionRequest = Readonly<{
  scope: PrivacySubjectScope
  /** A schema field name, never a value. */
  field: string
  value: unknown
}>

export type PrivacyContributorCounts = Readonly<{
  /** Rows this contributor changed or removed. Content-free. */
  affected: number
}>

export type PrivacySubjectContributor = Readonly<{
  context: string
  /**
   * Does this subject exist within EXACTLY this tenant and Property?
   *
   * Returns false for a cross-tenant or cross-property lookup; the lifecycle
   * refuses the request rather than returning an empty package, because an
   * empty package is indistinguishable from "you have no data here".
   */
  resolve(tx: Tx, scope: PrivacySubjectScope): Promise<boolean>
  /** Tenant/property-scoped, classified sections of the subject's own data. */
  access(tx: Tx, scope: PrivacySubjectScope): Promise<readonly PrivacyPackageSection[]>
  /** Updates ONLY the named field; leaves prior value history intact. */
  correct(tx: Tx, request: PrivacyCorrectionRequest): Promise<PrivacyContributorCounts>
  /** Retracts consent-bearing content, leaving a minimal tombstone. */
  withdraw(tx: Tx, scope: PrivacySubjectScope): Promise<PrivacyContributorCounts>
  /** Irreversible purge of the subject's content and contact. */
  erase(tx: Tx, scope: PrivacySubjectScope): Promise<PrivacyContributorCounts>
}>

export const PRIVACY_REQUEST_KIND_OPERATIONS: Readonly<
  Record<PrivacyRequestKind, keyof PrivacySubjectContributor>
> = Object.freeze({
  access: 'access',
  correction: 'correct',
  withdrawal: 'withdraw',
  erasure: 'erase',
})

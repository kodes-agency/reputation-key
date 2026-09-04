// LIF-01-T19 — durable authority + receipts for a permanent Property Erase.
//
// Every mutation here is a state transition on `property_erase_authorities`,
// which carries an ENABLE ALWAYS trigger enforcing the same transition table as
// the domain. The store is therefore the second of three independent guards on
// the irreversible boundary, not a convenience wrapper.

import type { PropertyEraseState } from '../../domain/property-erase'
import type {
  PropertyEraseContext,
  PropertyEraseInventoryEntry,
} from './property-erase-contributor.port'

export type PropertyEraseAuthority = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  state: PropertyEraseState
  requestedByUserId: string
  identityVerificationRef: string
  supportOperatorId: string
  supportAuthorizationRef: string
  retentionPreviewRef?: string
  exportEvidenceRef?: string
  inventoryRevision: number
  inventoryDigest?: string
  confirmationDigest?: string
  graceExpiresAt?: Date
  requestedAt: Date
  stateChangedAt: Date
}>

export type PropertyEraseRequestInput = Readonly<{
  organizationId: string
  propertyId: string
  requestedByUserId: string
  identityVerificationRef: string
  supportOperatorId: string
  supportAuthorizationRef: string
  evidenceRef: string
  correlationId: string
  requestedAt: Date
}>

export type PropertyErasePreviewInput = Readonly<{
  authorityId: string
  organizationId: string
  inventoryRevision: number
  inventoryDigest: string
  retentionPreviewRef: string
  exportEvidenceRef?: string
  occurredAt: Date
}>

export type PropertyEraseConfirmInput = Readonly<{
  authorityId: string
  organizationId: string
  confirmationDigest: string
  /** The revision the admin was actually shown. */
  inventoryRevision: number
  graceExpiresAt: Date
  occurredAt: Date
}>

export type PropertyEraseTransitionInput = Readonly<{
  authorityId: string
  from: PropertyEraseState
  to: PropertyEraseState
  occurredAt: Date
  /** Machine-readable code; never free text. */
  reasonCode?: string
}>

export type PropertyEraseContextReceipt = Readonly<{
  authorityId: string
  context: PropertyEraseContext
  phase: 'inventory' | 'purge'
  outcome: 'complete' | 'no_data'
  erasedRowCount: number
  evidenceRef: string
  occurredAt: Date
}>

export type PropertyEraseCommandStore = Readonly<{
  request(input: PropertyEraseRequestInput): Promise<PropertyEraseAuthority>
  load(
    authorityId: string,
    organizationId: string,
  ): Promise<PropertyEraseAuthority | null>
  /** The single Property this pass may work on, or null. Bounded work. */
  nextAdvanceable(now: Date): Promise<PropertyEraseAuthority | null>
  recordPreview(input: PropertyErasePreviewInput): Promise<PropertyEraseAuthority>
  confirm(input: PropertyEraseConfirmInput): Promise<PropertyEraseAuthority>
  transition(input: PropertyEraseTransitionInput): Promise<PropertyEraseAuthority>
  /** Append-only; a replay after an interruption reads these back. */
  recordContextReceipt(receipt: PropertyEraseContextReceipt): Promise<void>
  completedContexts(
    authorityId: string,
    phase: 'inventory' | 'purge',
  ): Promise<readonly PropertyEraseContext[]>
  /** Persisted content-free inventory, for the confirmation binding. */
  readInventory(authorityId: string): Promise<readonly PropertyEraseInventoryEntry[]>
}>

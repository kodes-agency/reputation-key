import type { ContactRequestScope } from '../../domain/contact-request'

export type ContactRequestManagerAuthorityBasis =
  'account_admin' | 'portal_creator' | 'responsible_manager'

/**
 * Cross-context authorization seam for manager relationships owned by
 * Identity, Staff, and Portal. Implementations must perform a fresh read for
 * the exact scope and instant supplied by the caller.
 *
 * The Guest contact row is stored in a separate transaction, so a revocation
 * can race in the narrow interval after this lookup and before the masked read
 * or reveal locks the contact row. Activation must either accept and monitor
 * that interval or replace this seam with a shared transactional authority
 * permit; the repository must not infer owning-context roles itself.
 */
export type ContactRequestManagerAuthorityPort = Readonly<{
  resolve(input: {
    scope: ContactRequestScope
    actorId: string
    at: Date
  }): Promise<ContactRequestManagerAuthorityBasis | null>
}>

export type ContactRequestManagerAuthorization = Readonly<{
  actorId: string
  basis: ContactRequestManagerAuthorityBasis
  checkedAt: Date
}>

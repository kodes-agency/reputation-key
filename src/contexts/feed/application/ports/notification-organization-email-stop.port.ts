import type { OrganizationEmailStop } from '../../domain/organization-email-stop'

/**
 * How far the Organization's lifecycle currently stops its outbound email.
 * Asked when an email is queued and again immediately before it is sent.
 */
export type NotificationOrganizationEmailStopPort = (
  organizationId: string,
) => Promise<OrganizationEmailStop>

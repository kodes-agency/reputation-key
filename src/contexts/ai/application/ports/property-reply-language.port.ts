import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/** Tenant-scoped property reply-language fact used by the AI drafting boundary. */
export type PropertyReplyLanguagePort = Readonly<{
  readDefaultReplyLanguage(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
    }>,
  ): Promise<string | null>
}>

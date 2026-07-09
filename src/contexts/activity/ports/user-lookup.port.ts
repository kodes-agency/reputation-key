import type { Role } from '#/shared/domain/roles'

export type UserInfo = Readonly<{
  name: string
  avatarUrl: string | null
  /** Built-in domain Role, or null for custom-only members. */
  role: Role | null
  /** Raw better-auth role string — preserved for owner detection / display. */
  rawRole: string
}>

export type UserLookupPort = Readonly<{
  lookup(userId: string, orgId: string): Promise<UserInfo>
}>

import type { Role } from '#/shared/domain/roles'

export type UserInfo = Readonly<{
  name: string
  avatarUrl: string | null
  role: Role
}>

export type UserLookupPort = Readonly<{
  lookup(userId: string, orgId: string): Promise<UserInfo>
}>

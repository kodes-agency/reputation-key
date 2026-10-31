import type { AuthContext } from '#/shared/domain/auth-context'
import type { ProductUpdateState } from '../product-updates-policy'

export type ProductUpdatePerson = Pick<AuthContext, 'userId' | 'organizationId'>
export type ProductUpdatesStore = Readonly<{
  read: (person: ProductUpdatePerson) => Promise<ProductUpdateState>
  claim: (person: ProductUpdatePerson) => Promise<boolean>
  markSeen: (person: ProductUpdatePerson, entryIds: readonly string[]) => Promise<void>
  setAutoShow: (person: ProductUpdatePerson, autoShow: boolean) => Promise<void>
}>

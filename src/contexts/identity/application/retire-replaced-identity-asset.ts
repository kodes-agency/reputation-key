// Identity context — remove the object a replaced avatar or logo leaves behind.
//
// The public route already stops serving it (nothing points at it any more);
// this frees the bytes. It is the owner's own previous object only: an address
// that is not one of ours, another owner's, or the one just saved is left alone.
// A store that refuses the delete leaves an unreferenced object, which is
// logged, never an error for the person who just saved a picture.

import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  identityAssetKeyFromPath,
  parseIdentityAssetKey,
  type IdentityAssetKey,
} from './identity-assets'

export type RetireReplacedIdentityAssetDeps = Readonly<{
  storage: Pick<StoragePort, 'deleteObject'>
  logger: Pick<LoggerPort, 'warn'>
}>

export type RetireReplacedIdentityAssetInput = Readonly<{
  /** The address stored before the change (a user's image or an organization's logo). */
  previous: string | null
  /** The key of the object that replaced it. */
  nextKey: string
  kind: IdentityAssetKey['kind']
  /** The user (avatar) or organization (logo) that owns the picture. */
  ownerId: string
}>

export const retireReplacedIdentityAsset =
  (deps: RetireReplacedIdentityAssetDeps) =>
  async (input: RetireReplacedIdentityAssetInput): Promise<void> => {
    const previousKey = input.previous ? identityAssetKeyFromPath(input.previous) : null
    if (!previousKey || previousKey === input.nextKey) return
    const parsed = parseIdentityAssetKey(previousKey)
    if (parsed?.kind !== input.kind || parsed.ownerId !== input.ownerId) return
    try {
      await deps.storage.deleteObject(previousKey)
    } catch (error) {
      deps.logger.warn(
        { err: error, errorCode: 'identity_asset_retire_failed', kind: input.kind },
        'A replaced image could not be deleted from the store',
      )
    }
  }

export type RetireReplacedIdentityAsset = ReturnType<typeof retireReplacedIdentityAsset>

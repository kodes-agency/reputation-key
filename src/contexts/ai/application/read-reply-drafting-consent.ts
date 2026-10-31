import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  requireAiPropertyReadAccess,
  type AiPropertyAccess,
} from './ai-property-read-access'
import type { AiAuthorizationPort } from './ports/ai-authorization.port'

/** An Inbox reader may check drafting availability without managing AI settings. */
export const createReadReplyDraftingConsent =
  (authorization: AiAuthorizationPort, propertyAccess: AiPropertyAccess) =>
  async (
    scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
    actor: AuthContext,
  ) => {
    await requireAiPropertyReadAccess(propertyAccess, actor, 'inbox.read', scope)
    const snapshot = await authorization.readMerchantAuthorization(scope)
    const runtime = snapshot?.capabilityRuntimeProfileVersions.reply_drafting
    if (snapshot?.state !== 'enabled' || !snapshot.authorizationLineageId || !runtime)
      return null
    return {
      subjectType: 'property' as const,
      subjectId: scope.propertyId,
      purpose: 'ai.generate_reply',
      expectedFence: {
        authorizationLineageId: snapshot.authorizationLineageId,
        capabilityEpoch: snapshot.capabilityEpochs.reply_drafting.epoch,
        authorizedSourceEpoch: snapshot.authorizedSourceEpoch,
        stateVersion: snapshot.stateVersion,
        noticeDigest: snapshot.noticeDigest,
        recordedRuntimeProfileVersion: runtime,
        servedExecution: getAiRuntimeCapability('reply_drafting'),
      },
    }
  }

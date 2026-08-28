// Integration context — governed Google OAuth exchange and connection commit.

import { z } from 'zod/v4'
import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import { isUniqueViolationError } from '../ports/google-connection.repository'
import type { IntegrationCommandStore } from '../ports/integration-command-store.port'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
  GoogleOAuthResult,
} from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ConnectGoogleInput } from '../dto/connect-google.dto'
export type { ConnectGoogleInput as ConnectGoogleAccountInput } from '../dto/connect-google.dto'
import { googleConnectionId } from '#/shared/domain/ids'
import { buildGoogleConnection } from '../../domain/constructors'
import type { GoogleConnectionId } from '../../domain/types'
import { integrationError } from '../../domain/errors'
import { integrationGoogleAccountConnected } from '../../domain/events'
import { canManageOrganizationGoogleConnections } from '../google-organization-authority'
import type { CaptureGoogleCredentialHome } from '../google-credential-home'
import type {
  GoogleOAuthExchangeAttemptFacts,
  GoogleOAuthExchangeRecoveryClaim,
  GoogleOAuthExchangeRecoveryStore,
} from '../google-oauth-exchange-recovery'

const preservedExchangeEnvelopeSchema = z
  .object({
    version: z.literal(1),
    oidcNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    result: z
      .object({
        accessToken: z
          .string()
          .min(1)
          .max(16 * 1024),
        refreshToken: z
          .string()
          .min(1)
          .max(16 * 1024),
        expiresIn: z.number().int().positive(),
        scopes: z.array(z.string().min(1).max(512)).min(1).max(16),
        idToken: z
          .string()
          .min(1)
          .max(64 * 1024),
      })
      .strict(),
  })
  .strict()

export type ConnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  commandStore: IntegrationCommandStore
  exchangeRecovery: GoogleOAuthExchangeRecoveryStore
  clock: () => Date
  idGen: () => string
  callbackUrl: string
  captureCredentialHome: CaptureGoogleCredentialHome
  authorizeProviderCall?: GoogleOAuthProviderCallAuthorizer
}>

export type ResumeGoogleAccountConnectionInput = Readonly<{ attemptId: string }>

function sameCredentialHome(
  left: GoogleOAuthExchangeAttemptFacts['credentialHome'],
  right: GoogleOAuthExchangeAttemptFacts['credentialHome'],
): boolean {
  return (
    left.homeCellId === right.homeCellId &&
    left.cataloguePolicyVersion === right.cataloguePolicyVersion &&
    left.authorityGeneration === right.authorityGeneration
  )
}

function recoveryDenied(code: string): never {
  throw integrationError(
    'oauth_failed',
    code === 'outcome_ambiguous'
      ? 'Google OAuth exchange outcome is ambiguous; start a new connection ceremony'
      : 'Google OAuth recovery is unavailable',
  )
}

export const connectGoogleAccount = (deps: ConnectGoogleAccountDeps) => {
  const completeConnection = async (
    facts: GoogleOAuthExchangeAttemptFacts,
    oauthResult: GoogleOAuthResult,
    ctx: AuthContext,
  ): Promise<GoogleConnection> => {
    if (!canManageOrganizationGoogleConnections(ctx)) {
      throw integrationError(
        'forbidden',
        'You do not have permission to manage integrations',
      )
    }
    if (
      facts.organizationId !== ctx.organizationId ||
      facts.initiatorUserId !== ctx.userId ||
      oauthResult.identity.kind !== 'oidc'
    ) {
      throw integrationError('oauth_failed', 'Google OAuth recovery scope changed')
    }

    const targetConnection =
      facts.connectionMode === 'new'
        ? await deps.connectionRepo.findById(
            ctx.organizationId,
            googleConnectionId(facts.connectionId),
          )
        : await deps.connectionRepo.findById(
            ctx.organizationId,
            googleConnectionId(facts.targetConnectionId ?? ''),
          )
    if (
      (facts.connectionMode === 'new' && targetConnection !== null) ||
      (facts.connectionMode !== 'new' &&
        (!targetConnection ||
          targetConnection.id !== facts.connectionId ||
          targetConnection.lifecycleVersion !== facts.expectedLifecycleVersion ||
          targetConnection.accessVersion !== facts.expectedAccessVersion ||
          targetConnection.credentialGeneration !== facts.expectedCredentialGeneration))
    ) {
      throw integrationError('oauth_failed', 'Google connection authority changed')
    }

    const credentialHome = await deps.captureCredentialHome({
      organizationId: ctx.organizationId,
      mode: facts.connectionMode,
      targetConnectionId: targetConnection?.id ?? null,
      changedBy: ctx.userId,
      now: deps.clock(),
    })
    if (!sameCredentialHome(credentialHome, facts.credentialHome)) {
      throw integrationError('oauth_failed', 'Google credential home changed')
    }

    const existingConnection = await deps.connectionRepo.findByGoogleIdentityGlobal({
      googleSubject: oauthResult.identity.googleSubject,
    })
    if (facts.connectionMode === 'new') {
      if (existingConnection) {
        throw integrationError(
          'account_already_connected',
          'This Google account is already connected',
        )
      }
    } else if (
      !targetConnection ||
      (targetConnection.googleSubject !== null &&
        targetConnection.googleSubject !== oauthResult.identity.googleSubject) ||
      (existingConnection !== null && existingConnection.id !== targetConnection.id)
    ) {
      throw integrationError(
        'account_already_connected',
        'This Google account does not match the requested connection',
      )
    }

    const now = deps.clock()
    const tokenExpiresAt = new Date(now.getTime() + oauthResult.expiresIn * 1_000)
    const encryptedAccessToken = deps.encryption.encrypt(oauthResult.accessToken)
    const encryptedRefreshToken = deps.encryption.encrypt(oauthResult.refreshToken)
    const event = integrationGoogleAccountConnected({
      connectionId: googleConnectionId(facts.connectionId),
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      occurredAt: now,
    })

    try {
      if (facts.connectionMode !== 'new') {
        return await deps.commandStore.reconnectGoogleAccount({
          organizationId: ctx.organizationId,
          connectionId: googleConnectionId(facts.connectionId),
          googleSubject: oauthResult.identity.googleSubject,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt,
          scopes: oauthResult.scopes,
          visibility: 'organization',
          credentialHome,
          credentialHomeReason:
            facts.connectionMode === 'reconnect'
              ? 'governed_reconnect'
              : 'credential_rotation',
          exchangeAttemptId: facts.id,
          event,
        })
      }

      const buildResult = buildGoogleConnection({
        id: googleConnectionId(facts.connectionId),
        organizationId: ctx.organizationId,
        identity: oauthResult.identity,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        scopes: oauthResult.scopes,
        connectedBy: ctx.userId,
        visibility: 'organization',
        credentialHome,
        now,
      })
      if (buildResult.isErr()) throw buildResult.error
      await deps.commandStore.connectGoogleAccount({
        connection: buildResult.value,
        credentialHomeBinding: credentialHome,
        exchangeAttemptId: facts.id,
        event,
      })
      return buildResult.value
    } catch (error) {
      if (!isUniqueViolationError(error)) throw error
      throw integrationError(
        'account_already_connected',
        'This Google account is already connected',
      )
    }
  }

  const validateClaim = async (
    claim: GoogleOAuthExchangeRecoveryClaim,
  ): Promise<GoogleOAuthResult> => {
    let envelope: z.infer<typeof preservedExchangeEnvelopeSchema>
    try {
      envelope = preservedExchangeEnvelopeSchema.parse(
        JSON.parse(deps.encryption.decrypt(claim.encryptedResult)),
      )
    } catch {
      await deps.exchangeRecovery.discardClaim({
        id: claim.id,
        organizationId: claim.organizationId,
        initiatorUserId: claim.initiatorUserId,
        outcomeCode: 'preserved_result_invalid',
        now: deps.clock(),
      })
      throw integrationError('oauth_failed', 'Google OAuth recovery data is invalid')
    }
    return deps.oauth.exchangeCode({
      contractVersion: 'v2',
      code: 'recovery-does-not-send-provider-code',
      redirectUri: deps.callbackUrl,
      codeVerifier: 'recovery-does-not-send-pkce-verifier',
      oidcNonce: envelope.oidcNonce,
      preservedResult: envelope.result,
    })
  }

  const claimAndComplete = async (
    attemptId: string,
    ctx: AuthContext,
    alreadyValidated?: GoogleOAuthResult,
  ): Promise<GoogleConnection> => {
    const claimed = await deps.exchangeRecovery.claimPreservedResult({
      id: attemptId,
      organizationId: ctx.organizationId,
      initiatorUserId: ctx.userId,
      now: deps.clock(),
    })
    if (!claimed.ok) {
      if (claimed.code === 'completed') {
        const completed = await deps.exchangeRecovery.loadCompletedAttempt({
          id: attemptId,
          organizationId: ctx.organizationId,
          initiatorUserId: ctx.userId,
        })
        if (completed) {
          const connection = await deps.connectionRepo.findById(
            ctx.organizationId,
            googleConnectionId(completed.connectionId),
          )
          if (
            connection &&
            connection.status === 'active' &&
            connection.credentialUseState === 'active' &&
            connection.lifecycleVersion === completed.expectedLifecycleVersion + 1 &&
            connection.accessVersion === completed.expectedAccessVersion + 1 &&
            connection.credentialGeneration ===
              completed.expectedCredentialGeneration + 1 &&
            connection.credentialAuthorizedBy === ctx.userId &&
            connection.credentialHomeCellId === completed.credentialHome.homeCellId &&
            connection.credentialHomePolicyVersion ===
              completed.credentialHome.cataloguePolicyVersion &&
            connection.credentialHomeAuthorityGeneration ===
              completed.credentialHome.authorityGeneration
          ) {
            return connection
          }
        }
      }
      return recoveryDenied(claimed.code)
    }
    try {
      const oauthResult = alreadyValidated ?? (await validateClaim(claimed.value))
      return await completeConnection(claimed.value, oauthResult, ctx)
    } catch (error) {
      const deterministic =
        typeof error === 'object' &&
        error !== null &&
        ['account_already_connected', 'forbidden'].includes(
          String((error as { code?: unknown }).code),
        )
      await (deterministic
        ? deps.exchangeRecovery.discardClaim({
            id: claimed.value.id,
            organizationId: claimed.value.organizationId,
            initiatorUserId: claimed.value.initiatorUserId,
            outcomeCode: 'connection_commit_rejected',
            now: deps.clock(),
          })
        : deps.exchangeRecovery.releaseClaim({
            id: claimed.value.id,
            organizationId: claimed.value.organizationId,
            initiatorUserId: claimed.value.initiatorUserId,
            outcomeCode: 'connection_commit_retryable',
            now: deps.clock(),
          }))
      throw error
    }
  }

  const connect = async (
    input: ConnectGoogleInput,
    ctx: AuthContext,
  ): Promise<GoogleConnection> => {
    if (!canManageOrganizationGoogleConnections(ctx)) {
      throw integrationError(
        'forbidden',
        'You do not have permission to manage integrations',
      )
    }
    const targetConnection =
      input.connectionMode === 'new'
        ? null
        : await deps.connectionRepo.findById(
            ctx.organizationId,
            input.targetConnectionId as GoogleConnectionId,
          )
    if (input.connectionMode !== 'new' && !targetConnection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }
    const credentialHome = await deps.captureCredentialHome({
      organizationId: ctx.organizationId,
      mode: input.connectionMode,
      targetConnectionId: targetConnection?.id ?? null,
      changedBy: ctx.userId,
      now: deps.clock(),
    })
    const connectionId = targetConnection?.id ?? googleConnectionId(deps.idGen())
    const facts: GoogleOAuthExchangeAttemptFacts = {
      id: input.exchangeAttemptId,
      organizationId: ctx.organizationId,
      initiatorUserId: ctx.userId,
      connectionId,
      connectionMode: input.connectionMode,
      targetConnectionId: targetConnection?.id ?? null,
      expectedLifecycleVersion: targetConnection?.lifecycleVersion ?? 0,
      expectedAccessVersion: targetConnection?.accessVersion ?? 0,
      expectedCredentialGeneration: targetConnection?.credentialGeneration ?? 0,
      credentialHome,
    }
    const begun = await deps.exchangeRecovery.begin({ ...facts, now: deps.clock() })
    if (!begun.ok) return recoveryDenied(begun.code)
    const providerAuthorization = deps.authorizeProviderCall
      ? await deps.authorizeProviderCall({
          operation: 'oauth.token.exchange',
          organizationId: ctx.organizationId,
          connectionId,
          initiatorUserId: ctx.userId,
        })
      : undefined
    const started = await deps.exchangeRecovery.markProviderStarted({
      id: facts.id,
      organizationId: facts.organizationId,
      initiatorUserId: facts.initiatorUserId,
      now: deps.clock(),
    })
    if (!started.ok) return recoveryDenied(started.code)

    let preserved = false
    let oauthResult: GoogleOAuthResult
    try {
      oauthResult = await deps.oauth.exchangeCode({
        contractVersion: 'v2',
        code: input.code,
        redirectUri: deps.callbackUrl,
        codeVerifier: input.verifierMaterial.codeVerifier,
        oidcNonce: input.verifierMaterial.oidcNonce,
        ...(providerAuthorization ? { authorization: providerAuthorization } : {}),
        preserveSuccessfulResult: async (result) => {
          const encryptedResult = deps.encryption.encrypt(
            JSON.stringify({
              version: 1,
              oidcNonce: input.verifierMaterial.oidcNonce,
              result,
            }),
          )
          const stored = await deps.exchangeRecovery.preserveSuccessfulResult({
            id: facts.id,
            organizationId: facts.organizationId,
            initiatorUserId: facts.initiatorUserId,
            encryptedResult,
            now: deps.clock(),
          })
          if (!stored.ok) return recoveryDenied(stored.code)
          preserved = true
        },
      })
      if (!preserved) {
        throw integrationError(
          'oauth_failed',
          'Google OAuth adapter did not preserve the successful response',
        )
      }
    } catch (error) {
      if (!preserved) {
        await deps.exchangeRecovery.finishWithoutResult({
          id: facts.id,
          organizationId: facts.organizationId,
          initiatorUserId: facts.initiatorUserId,
          outcome: 'provider_outcome_ambiguous',
          outcomeCode: 'exchange_result_not_preserved',
          now: deps.clock(),
        })
      }
      throw error
    }
    return claimAndComplete(facts.id, ctx, oauthResult)
  }

  const resume = async (
    input: ResumeGoogleAccountConnectionInput,
    ctx: AuthContext,
  ): Promise<GoogleConnection> => claimAndComplete(input.attemptId, ctx)

  return Object.assign(connect, { resume })
}

export type ConnectGoogleAccount = ReturnType<typeof connectGoogleAccount>
export type ResumeGoogleAccountConnection = ReturnType<
  typeof connectGoogleAccount
>['resume']

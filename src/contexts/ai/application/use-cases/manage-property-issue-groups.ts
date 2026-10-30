// Dark application commands for manager presentation and same-topic merges.
// PR-4 decides their permission and publishes them; this slice deliberately
// adds them to neither publicApi nor composition. The supplied Property scope is
// therefore already authorized. Display names are manager text and must never
// enter provider input, logs or events.

import { aiError } from '../../domain/errors'
import type {
  AiIssueGroupStorePort,
  PropertyIssueMergeResult,
  PropertyIssueMutationResult,
  PropertyIssueResolveResult,
  PropertyIssueScope,
  PropertyIssueVisibilityResult,
} from '../ports/ai-issue-group-store.port'

const DISPLAY_NAME_MAX_LENGTH = 80
const ACTOR_ID_MAX_LENGTH = 255
const CONTROL_OR_LINE_BREAK = /[\p{Cc}\p{Zl}\p{Zp}]/u

export type ManagePropertyIssueGroupsDeps = Readonly<{
  store: AiIssueGroupStorePort
  clock: () => Date
}>

export type ManagePropertyIssueGroups = ReturnType<typeof createManagePropertyIssueGroups>

function normalizedDisplayName(value: string | null): string | null {
  if (value === null) return null
  const compatible = value.normalize('NFKC')
  if (CONTROL_OR_LINE_BREAK.test(compatible)) {
    throw aiError('invalid_request', 'Property issue display name is invalid')
  }
  const normalized = compatible.trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0) return null
  if ([...normalized].length > DISPLAY_NAME_MAX_LENGTH) {
    throw aiError('invalid_request', 'Property issue display name is invalid')
  }
  return normalized
}

function validActorId(actorUserId: string): boolean {
  return (
    actorUserId.length >= 1 &&
    actorUserId.length <= ACTOR_ID_MAX_LENGTH &&
    actorUserId === actorUserId.trim() &&
    !CONTROL_OR_LINE_BREAK.test(actorUserId)
  )
}

export function createManagePropertyIssueGroups(
  deps: ManagePropertyIssueGroupsDeps,
): Readonly<{
  rename: (
    scope: PropertyIssueScope,
    issueId: string,
    displayName: string | null,
  ) => Promise<PropertyIssueMutationResult>
  hide: (
    scope: PropertyIssueScope,
    issueId: string,
    actorUserId: string,
  ) => Promise<PropertyIssueVisibilityResult>
  show: (
    scope: PropertyIssueScope,
    issueId: string,
  ) => Promise<PropertyIssueVisibilityResult>
  merge: (
    scope: PropertyIssueScope,
    sourceIssueId: string,
    targetIssueId: string,
  ) => Promise<PropertyIssueMergeResult>
  resolve: (
    scope: PropertyIssueScope,
    issueId: string,
  ) => Promise<PropertyIssueResolveResult>
}> {
  return Object.freeze({
    rename: async (scope, issueId, displayName) =>
      deps.store.rename(scope, issueId, normalizedDisplayName(displayName), deps.clock()),
    hide: async (scope, issueId, actorUserId) => {
      if (!validActorId(actorUserId)) {
        throw aiError('invalid_request', 'Property issue actor is invalid')
      }
      const now = deps.clock()
      return deps.store.setHidden(scope, issueId, { at: now, by: actorUserId }, now)
    },
    show: async (scope, issueId) =>
      deps.store.setHidden(scope, issueId, null, deps.clock()),
    merge: async (scope, sourceIssueId, targetIssueId) =>
      deps.store.merge(scope, sourceIssueId, targetIssueId, deps.clock()),
    resolve: async (scope, issueId) => deps.store.resolve(scope, issueId),
  })
}

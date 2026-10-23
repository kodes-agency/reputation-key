// Composition seam for `pnpm ops inbox exclude-restated-revision-targets`: the
// two contexts it joins, expressed as the plain-string ports the operator
// command is written against (src/shared/ops). Review supplies the restated
// revisions and Inbox finds and writes the cycles they opened; neither context
// reads the other's tables.

import type { InboxContextApi } from '#/contexts/inbox/build'
import type { ReviewContextApi } from '#/contexts/review/build'
import { inboxItemId, organizationId, propertyId } from '#/shared/domain/ids'
import type { ExclusionPorts } from '#/shared/ops/inbox-exclude-restated-revision-targets-command'

type InboxExclusions = InboxContextApi['maintenance']['responseTargetExclusions']
type ReviewRestatedRevisions = ReviewContextApi['maintenance']['restatedRevisions']

const brandedScope = (
  scope: Readonly<{ organizationId: string; propertyId: string }>,
) => ({
  organizationId: organizationId(scope.organizationId),
  propertyId: propertyId(scope.propertyId),
})

export function createRestatedRevisionExclusionPorts(
  input: Readonly<{
    inbox: InboxExclusions
    review: ReviewRestatedRevisions
    now: () => Date
  }>,
): ExclusionPorts {
  const { inbox, review, now } = input
  return {
    findProperty: (id) => inbox.findProperty(id),
    listRestatedRevisions: (scope) => review.list(brandedScope(scope)),
    scan: async ({ scope, restated }) =>
      (await inbox.scan({ scope: brandedScope(scope), restated })).candidates,
    apply: ({ scope, candidates, audit }) =>
      inbox.apply({
        scope: brandedScope(scope),
        candidates: candidates.map((candidate) => ({
          ...candidate,
          inboxItemId: inboxItemId(candidate.inboxItemId),
        })),
        audit,
      }),
    now,
  }
}

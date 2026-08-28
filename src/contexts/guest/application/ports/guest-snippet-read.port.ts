// Guest context — snippet read port.
//
// ARC-03-T11: the Inbox needs guest-authored comment/rating snippets to render
// feedback items. Feedback spans two storage generations (the guest_responses
// aggregate the live form writes, and the legacy feedback/ratings pair), so the
// root used to reach into BOTH Guest repositories (the response aggregate and
// the legacy interaction repository) to assemble the Inbox's source object.
//
// This port names that read surface. Guest owns it, Guest implements it in its
// build, and the root only forwards it — no repository crosses the boundary.

import type { FeedbackId, OrganizationId } from '#/shared/domain/ids'
import type {
  GuestResponseContentFilter,
  GuestResponseSnippet,
} from './guest-response.repository'
import type {
  LegacyFeedbackContentFilter,
  LegacyFeedbackSnippet,
} from './guest-interaction.repository'

export type GuestSnippetReadPort = Readonly<{
  /** Aggregate-generation snippets by response id. */
  findResponseSnippetsByIds: (
    ids: ReadonlyArray<string>,
    organizationId: string,
  ) => Promise<ReadonlyArray<GuestResponseSnippet>>
  /** Aggregate-generation ids matching the Inbox content filter. */
  findEligibleResponseIds: (
    organizationId: string,
    filter: GuestResponseContentFilter,
  ) => Promise<ReadonlyArray<string>>
  /** Legacy feedback/ratings snippets by feedback id. */
  findLegacyFeedbackSnippetsByIds: (
    ids: ReadonlyArray<FeedbackId>,
    organizationId: OrganizationId,
  ) => Promise<ReadonlyArray<LegacyFeedbackSnippet>>
  /** Legacy feedback ids matching the Inbox content filter. */
  findEligibleLegacyFeedbackIds: (
    organizationId: OrganizationId,
    filter: LegacyFeedbackContentFilter,
  ) => Promise<ReadonlyArray<FeedbackId>>
}>

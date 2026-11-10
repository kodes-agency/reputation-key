// S12 — executable registry for reviewed tenant-free infrastructure queries.
//
// Every entry names the narrow query boundary that may omit an organization
// predicate. The tenant-predicate canary verifies that entries still point to a
// real callable and rejects unrecorded tenant-free repository queries.
//
// A query is tenant-free when no statement of its callable is restricted to a
// tenant value (tenant-predicate-constraint.ts says what counts). A callable
// that restricts one statement and not another is not listed here: its
// unrestricted statements are counted in tenant-predicate-statement-baseline.ts.
// The category says why a tenant-free query is acceptable:
//
//   LEGITIMATE-GLOBAL  crosses tenants on purpose: a bounded sweep, a health
//                      gauge, a global uniqueness check, or a worker step that
//                      addresses a row by the id its own schedule minted.
//   PUBLIC-TOKEN       finds a row by a capability presented before any tenant
//                      is known, and derives the tenant from that row.
//   OWNER-LOOKUP       returns only which Organization (and Property) owns an
//                      id, so the caller can refuse a foreign one. The canary
//                      checks that the callable reads the tenant column.
//   TENANT-CHECKED     reads a row by its id and the same callable refuses a
//                      row of another Organization. The canary checks that it
//                      compares two tenant values.
//   TENANT-CORRELATED  builds a fragment or subquery whose rows are tied to the
//                      embedding statement's row on the tenant column; the
//                      embedding statement owns the scope. The canary checks
//                      the tie.
//   UNSCOPED-PENDING   a known gap with a dated note. None may be registered.

export type TenantPredicateExemptionCategory =
  | 'LEGITIMATE-GLOBAL'
  | 'PUBLIC-TOKEN'
  | 'OWNER-LOOKUP'
  | 'TENANT-CHECKED'
  | 'TENANT-CORRELATED'
  | 'UNSCOPED-PENDING'

export type TenantPredicateExemption = Readonly<{
  /** Repository-relative path. */
  file: string
  /** Function, method, or object-property callable containing the query. */
  symbol: string
  /** The reviewed reason the query currently has no tenant predicate. */
  reason: string
  category: TenantPredicateExemptionCategory
}>

export const TENANT_PREDICATE_EXEMPTIONS: readonly TenantPredicateExemption[] = [
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-profile-rebuild.ts',
    symbol: 'listPendingProfileRebuilds',
    reason:
      'The bounded worker sweep enumerates rolled profile identifiers across tenants. Each rebuild locks its Property and rechecks the tenant, source, active profile and merchant authorization before mutation.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts',
    symbol: 'claim',
    reason:
      'The unique idempotency-scope digest includes organization and property identity for tenant operations while supporting explicitly tenant-free release canaries.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts',
    symbol: 'listExpiredExecutions',
    reason:
      'The bounded abandoned-execution sweep intentionally scans all tenants and every candidate is rechecked by an exact operation-attempt CAS before mutation.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/reporting/infrastructure/repositories/goal-program.repository.ts',
    symbol: 'hydrateBundles',
    reason:
      'The hydration query receives a finite set of already-authorized or globally scheduled program rows and loads children only through their globally unique parent IDs.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/reporting/infrastructure/repositories/goal-monthly-result.repository.ts',
    symbol: 'listDueResults',
    reason:
      'The bounded goal-maintenance scheduler intentionally enumerates due result records across all tenants before tenant-preserving maintenance work.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/guest/infrastructure/repositories/contact-request.repository.ts',
    symbol: 'purgeExpiredContactRequests',
    reason:
      'The checkpointed retention sweep intentionally purges expired contact requests across tenants in a bounded, globally serialized transaction.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/guest/infrastructure/resolvers/portal-context-resolver.ts',
    symbol: 'resolve',
    reason:
      'Unauthenticated guest resolution starts from an unguessable Portal UUID capability and must discover the owning tenant before any scoped operation.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/identity/infrastructure/repositories/capability-refusal.repository.ts',
    symbol: 'loadPermitOutcomes',
    reason:
      'The operator command (scripts/ops/report-capability-refusal.ts) reads refusal-control health across tenants by global capability and correlation identifiers only; the tenant request surface binds loadOrganizationPermitOutcomes, which is restricted to the asking Organization.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/identity/infrastructure/repositories/merchant-ai-standing-renewal.repository.ts',
    symbol: 'listLapsed',
    reason:
      'The standing-renewal sweep lists enabled heads on a lapsed notice across tenants with one indexed read; each Property is then renewed in its own transaction, which re-reads the head by organization and Property and rechecks its state version.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/identity/infrastructure/repositories/google-content-authority.repository.ts',
    symbol: 'fenceActivePermits',
    reason:
      'A global capability kill switch must fence every active permit for that capability across tenants in one authority transaction.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/identity/infrastructure/repositories/google-content-authority.repository.ts',
    symbol: 'hasActiveCapabilityWork',
    reason:
      'The global capability-control transaction must detect any remaining admitted work across tenants before completing its fence transition.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/identity/infrastructure/repositories/google-content-authority.repository.ts',
    symbol: 'listElapsedAdmittedPermitIds',
    reason:
      'The bounded global deadline sweep enumerates elapsed admitted permits across tenants so each permit can be fenced by its authority workflow.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/inbox/infrastructure/migrations/null-inbox-source-copies.ts',
    symbol: 'nullInboxSourceCopies',
    reason:
      'The bounded corrective migration intentionally removes copied source content from every affected legacy inbox row across tenants.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/integration/infrastructure/durable-import-reference-claims.ts',
    symbol: 'consumeCandidateClaims',
    reason:
      'Candidate claims are addressed by keyed opaque reference digests before tenant scope is disclosed, and ownership is verified before deletion.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/integration/infrastructure/durable-import-reference-claims.ts',
    symbol: 'lockedRows',
    reason:
      'The keyed opaque discovery-reference digests are capability identifiers that must be locked before their owning tenant scope can be recovered.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/integration/infrastructure/durable-import-reference-claims.ts',
    symbol: 'releaseCandidateClaims',
    reason:
      'Candidate claims are addressed by keyed opaque reference digests before tenant scope is disclosed, and ownership is verified before release.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/integration/infrastructure/durable-import-reference-persistence.ts',
    symbol: 'durableImportReferenceExists',
    reason:
      'The keyed opaque import-reference digest is checked for global replay uniqueness before the referenced row can disclose its tenant scope.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/integration/infrastructure/durable-import-reference-persistence.ts',
    symbol: 'loadDurableImportRecord',
    reason:
      'The keyed opaque import-reference digest is the capability presented before tenant scope is known, so the lookup derives scope from its row.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/integration/infrastructure/repositories/google-connection.repository.ts',
    symbol: 'listOrganizationIdsWithActiveConnections',
    reason:
      'The daily GBP push reconciliation enumerates the organizations holding an active Google connection, identifiers only, and re-authorizes each organization before any tenant work.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/integration/infrastructure/repositories/google-connection.repository.ts',
    symbol: 'findByGoogleIdentityGlobal',
    reason:
      'Google subject identity is a global uniqueness authority; this explicitly global lookup prevents one provider identity from binding across tenants.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/notification-email.repository.ts',
    symbol: 'recordProviderState',
    reason:
      'A signed provider webhook names a message only by the id the provider assigned at acceptance, before tenant scope is known; the id is unique per send and the update returns each moved row with its tenant identifiers.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/notification-email.repository.ts',
    symbol: 'findProviderMessageRecipients',
    reason:
      'A retried provider webhook re-applies a suppression for the message the provider id names, before tenant scope is known; the read returns each row with its tenant identifiers.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/account-access-removal.repository.ts',
    symbol: 'findLatestForUser',
    reason:
      "A removed member is asked why their workspace is gone while they are outside every tenant: the notice that answers lives in the Organization they can no longer open. The read is scoped to the session's own user id, admits one notification type, and returns an instant only — no Organization identity, name, actor or row id.",
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/notification-gap.repository.ts',
    symbol: 'countItemsMissingNotifications',
    reason:
      'The bounded health gauge intentionally counts notification gaps across all tenants and returns no tenant-owned content or identifiers.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/one-click-unsubscribe.repository.ts',
    symbol: 'targetScopes',
    reason:
      'A signed one-click unsubscribe token identifies the queue target before tenant scope is known, and this lookup derives every affected tenant scope.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-approved-destination.repository.ts',
    symbol: 'listDueForNetworkRevalidation',
    reason:
      'The bounded network-revalidation scheduler intentionally enumerates due approved destinations across tenants and preserves tenant identity per row.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-media-asset.repository.ts',
    symbol: 'findForPublicRead',
    reason:
      'A guest has no tenant: the asset id is a random UUID presented as a capability, and the caller serves the row only if it is still active.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-media-asset.repository.ts',
    symbol: 'listTakenDownWithObject',
    reason:
      'The bounded media sweep intentionally finishes taken-down object removals across tenants and preserves tenant identity on every row it returns.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-media-asset.repository.ts',
    symbol: 'listUnreferencedBefore',
    reason:
      'The bounded media sweep intentionally enumerates old unreferenced images across tenants, and each candidate is rechecked by tenant-scoped discardIfUnreferenced before anything is deleted.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/reply.repository.ts',
    symbol: 'findDuePublicationBatch',
    reason:
      'The bounded publication-reconciliation scheduler intentionally enumerates due replies across tenants and preserves organization identity on every result.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'expireRawSourceBatch',
    reason:
      'The bounded compatibility lifecycle read intentionally translates a global review-expiry cursor before delegating to the canonical purge authority.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review.repository.ts',
    symbol: 'countExpiredBeforeAcrossTenants',
    reason:
      'The restore and purge completion probe intentionally counts expired review content across all tenants to prove that no eligible rows remain.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review.repository.ts',
    symbol: 'clockBatchAcrossTenants',
    reason:
      'The bounded review-content lifecycle sweeps (refresh-expiring and purge-expired) intentionally page live review content across all tenants by one stable expiration cursor so every eligible row is reached, and preserve tenant identity on every result.',
    category: 'LEGITIMATE-GLOBAL',
  },
  ...(['repeatCtes', 'scanRepeats', 'pruneRepeats'] as const).map((symbol) => ({
    file: 'src/contexts/review/infrastructure/repositories/observation-retention.repository.ts',
    symbol,
    reason:
      "The operator's repeat prune (ADR 0055, note 2026-10-24 (b)) pages Reviews across tenants by id, or within the one Organization it is given, and reads each Review's observations by its id, whose tenant the foreign key fixes; it returns counts and a Review id only.",
    category: 'LEGITIMATE-GLOBAL' as const,
  })),
  {
    file: 'src/contexts/review/infrastructure/repositories/observation-retention.repository.ts',
    symbol: 'redactExpiredSupersededCopies',
    reason:
      'The daily retention sweep blanks superseded observation copies past their content clock across tenants, oldest clock first in bounded batches, joining each row to its Review on Organization; it returns a count only.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-output-store.adapter.ts',
    symbol: 'findCurrentReviewIdsByAspect',
    reason:
      "The EXISTS subquery ties aspect mentions to the analysis row on Organization and Property; findCurrentAnalysisReviewIds, which embeds it, restricts the analysis rows to the caller's Organization.",
    category: 'TENANT-CORRELATED',
  },
  {
    file: 'src/contexts/ai/replay/backlog-store.server.ts',
    symbol: 'claimReady',
    reason:
      'The bounded backlog drain intentionally claims ready review-analysis work across tenants, a few entries per Property, and returns each entry with its Organization and Property.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/replay/enrollment-store.server.ts',
    symbol: 'listActionable',
    reason:
      'The bounded enrollment advance intentionally lists queued and running enrollments across tenants and returns each with its Organization and Property.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/replay/reopen-store.server.ts',
    symbol: 'abandonedInCurrentLineageSql',
    reason:
      'The fragment joins enablement and operations to the review row on Organization and Property; reopenProperty restricts it to one Property of one Organization, and reopenAbandoned is the registered cross-tenant sweep.',
    category: 'TENANT-CORRELATED',
  },
  {
    file: 'src/contexts/ai/replay/reopen-store.server.ts',
    symbol: 'abandonedOperationSql',
    reason:
      "The fragment counts a review's earlier abandoned operations and ties them to the review row on Organization and Property; the statement that embeds it owns the tenant scope.",
    category: 'TENANT-CORRELATED',
  },
  {
    file: 'src/contexts/ai/replay/reopen-store.server.ts',
    symbol: 'currentSequenceAnalysedSql',
    reason:
      'The fragment asks whether the review row has a ready analysis and ties the analysis to that row on Organization and Property; the statement that embeds it owns the tenant scope.',
    category: 'TENANT-CORRELATED',
  },
  {
    file: 'src/contexts/ai/replay/reopen-store.server.ts',
    symbol: 'currentSequenceSettledSql',
    reason:
      'The fragment asks whether the review row is settled and ties the settlement to that row on Organization and Property; the statement that embeds it owns the tenant scope.',
    category: 'TENANT-CORRELATED',
  },
  {
    file: 'src/contexts/ai/replay/reopen-store.server.ts',
    symbol: 'reviewAnalysisOutstandingSql',
    reason:
      'The fragment ties operations, settlements and analyses to the review row on Organization and Property; the statement that embeds it restricts the review rows to one Property of one Organization.',
    category: 'TENANT-CORRELATED',
  },
  {
    file: 'src/contexts/ai/replay/reopen-store.server.ts',
    symbol: 'reopenAbandoned',
    reason:
      'The bounded reopen sweep intentionally finds Properties with abandoned review analysis across tenants and reopens each one inside a transaction scoped to its Organization and Property.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/replay/reopen-store.server.ts',
    symbol: 'listSpentReviewAnalyses',
    reason:
      'The operator command ops:ai-reopen-analyses lists, for one Property or with `all` across tenants, the reviews whose automatic reopens are spent; it returns ids and codes only, each row carrying its Organization and Property.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/replay/reopen-store.server.ts',
    symbol: 'reopenSpentReviewAnalyses',
    reason:
      'The operator command ops:ai-reopen-analyses finds Properties with spent review analysis, for one Property or with `all` across tenants, and reopens each one inside transactions scoped to its Organization and Property, as reopenAbandoned does.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/operational-action-history-store.ts',
    symbol: 'placeLegalHold',
    reason:
      'A legal hold is read by its id to settle a retry, and a row whose Organization differs from the hold being placed is refused as a conflict.',
    category: 'TENANT-CHECKED',
  },
  {
    file: 'src/contexts/feed/infrastructure/operational-action-history-store.ts',
    symbol: 'releaseLegalHold',
    reason:
      'A legal hold is locked by its id, and a hold of another Organization is reported as not found before it can be released.',
    category: 'TENANT-CHECKED',
  },
  {
    file: 'src/contexts/feed/preferences/copy-category-defaults.server.ts',
    symbol: 'countCategoryDefaultsToCopy',
    reason:
      'An operator count across every Organization of category defaults without a matching preference row; it returns two numbers and no row content.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/preferences/copy-category-defaults.server.ts',
    symbol: 'copyCategoryDefaultsToPreferences',
    reason:
      'An operator copy in bounded batches across every Organization; each default is written to a row with the same user, Organization, category and channel, and only counts are reported.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/notification-delivery-lag.repository.ts',
    symbol: 'readSendableImmediateEmailRows',
    reason:
      'The notification delivery-lag gauge lists the Organization and Property of every immediate email in its window across tenants, then reads statuses and instants, no content, for the ones the beta gate allows: an allowed Property, or an allowed Organization where the email has none.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/notification-due-recipients.query.ts',
    symbol: 'dueRecipientsInVisitOrder',
    reason:
      'The due-recipient sweep orders recipients across tenants by local send hour from the due predicate its caller supplies, and returns only Organization and user identifiers.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/notification-email.repository.ts',
    symbol: 'findDueOrganizationScopes',
    reason:
      'The immediate-email sweep enumerates the Organizations that hold due Organization-level email, identifiers only and capped, so each one is then worked under its own scope.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/notification-email.repository.ts',
    symbol: 'findDueRecipients',
    reason:
      'The email sweeps intentionally enumerate due recipients and open digest batches across tenants, capped, and return only each recipient with its Organization.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/notification.repository.ts',
    symbol: 'mayBecomeUnread',
    reason:
      'The fragment looks for an unread sibling of the notification row being changed and ties it to that row on Organization; the statement that embeds it owns the tenant scope.',
    category: 'TENANT-CORRELATED',
  },
  {
    file: 'src/contexts/feed/notify/write.server.ts',
    symbol: 'writeNotification',
    reason:
      'The waiting slot is unique per user, type and resource, an index that carries no Organization, so the locked read finds the one row that index guards; the row it merges into and the one it inserts both take their Organization from the notification being written.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/feed/infrastructure/repositories/one-click-unsubscribe.repository.ts',
    symbol: 'apply',
    reason:
      'A signed one-click unsubscribe token identifies the delivered email or digest before tenant scope is known; the preferences written take their Organization from the scopes that token represents.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/identity/infrastructure/repositories/google-content-authority.repository.ts',
    symbol: 'lockPermit',
    reason:
      'The global start-deadline sweep locks each elapsed permit by the id listElapsedAdmittedPermitIds returned; the Organization filter is optional and that sweep, the only caller, omits it.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/inbox/infrastructure/response-target-reminder-release.store.ts',
    symbol: 'selectDueSlots',
    reason:
      'The bounded reminder release lists, and locks the targets of, due Response Target reminders across tenants (or the one slot named by its key); every row carries its own Organization and Property, which the release and the Google check then use.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/inbox/infrastructure/response-target-reminder-release.store.ts',
    symbol: 'settleLockedSlot',
    reason:
      "Delivers or cancels one reminder slot whose target the cross-tenant release has just locked, addressed by the slot's own key (item, cycle, kind), and publishes its fact with the row's own Organization and Property.",
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/inbox/infrastructure/restated-revision-target-exclusion.store.ts',
    symbol: 'findProperty',
    reason:
      'Returns only the Organization and Property that own the Property id an operator typed on `pnpm ops inbox exclude-restated-revision-targets`, so the command can refuse an unknown id and scope every later statement to that Organization; it reads no other column.',
    category: 'OWNER-LOOKUP',
  },
  {
    file: 'src/contexts/integration/infrastructure/durable-import-reference-claims.ts',
    symbol: 'claimCandidates',
    reason:
      'Candidate claims are addressed by keyed opaque reference digests before tenant scope is disclosed; the claim is refused unless every locked record belongs to the requesting Organization and user.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/integration/imports/import-store.server.ts',
    symbol: 'listExpiredItems',
    reason:
      'The bounded import lifecycle sweep lists at most 100 expired checkpoints across tenants. Each result carries its Organization and retry revision for tenant-scoped receipt reconciliation and terminalization.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/integration/imports/import-retention.server.ts',
    symbol: 'listPurgeCandidates',
    reason:
      'The bounded retention sweep lists terminal roots past their fixed purge time across tenants. Deletion checks each selected Organization, root and deletion fence under the root lock.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/integration/imports/import-dispatch-store.server.ts',
    symbol: 'createImportDueReservation',
    reason:
      'Recovery reserves at most 100 due active checkpoints across tenants with SKIP LOCKED. Each appointment update and later claim or effect is scoped to the reserved Organization.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/integration/imports/import-completion.server.ts',
    symbol: 'completeImportsForRestore',
    reason:
      'The isolated restore recovery fence intentionally inventories active or retryable import checkpoints and unfinished parents across tenants. Each completion and parent reduction checks the selected Organization inside the serialized recovery transaction.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/integration/infrastructure/repositories/google-disconnect-revoke.repository.ts',
    symbol: 'reconcileElapsed',
    reason:
      'The bounded disconnect-revoke reconciliation walks elapsed attempts across tenants and reads the cleanup permit of each by the permit id that attempt recorded.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-publication.repository.ts',
    symbol: 'resolveActiveByTokenDigest',
    reason:
      'The public Portal token digest is the capability a guest presents before tenant identity is known, so the lookup derives the Portal and its live publication from the token row.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-scope.repository.ts',
    symbol: 'resolvePortal',
    reason:
      'Returns only the Organization and Property that own a Portal id; the Portal server functions pass it to requirePortalResourceScope or requireMatchingPortalResourceScopes, which answer not found for any Organization but the caller.',
    category: 'OWNER-LOOKUP',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-scope.repository.ts',
    symbol: 'resolveGroup',
    reason:
      'Returns only the Organization and Property that own a Portal Group id; the Portal server functions pass it to requirePortalResourceScope or requireMatchingPortalResourceScopes, which answer not found for any Organization but the caller.',
    category: 'OWNER-LOOKUP',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-scope.repository.ts',
    symbol: 'resolveCategory',
    reason:
      'Returns only the Organization, Property and Portal that own a link category id; the Portal server functions pass it to requirePortalResourceScope or requireMatchingPortalResourceScopes, which answer not found for any Organization but the caller.',
    category: 'OWNER-LOOKUP',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal-scope.repository.ts',
    symbol: 'resolveLink',
    reason:
      'Returns only the Organization, Property and Portal that own a link id; the Portal server functions pass it to requirePortalResourceScope or requireMatchingPortalResourceScopes, which answer not found for any Organization but the caller.',
    category: 'OWNER-LOOKUP',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/portal.repository.ts',
    symbol: 'resolvePortalContext',
    reason:
      'Returns only the Organization and Property that own a Portal id: a guest presents the id before any tenant is known, and Reporting compares the answer with its own Organization.',
    category: 'OWNER-LOOKUP',
  },
  {
    file: 'src/contexts/property/infrastructure/repositories/property.repository.ts',
    symbol: 'listByGbpLocationId',
    reason:
      "A verified Google notification names a location before any tenant is known. A location is unique only within an Organization, so the lookup answers with every Property that holds it, each with its own Organization, in a fixed order; the one caller, the notification handler, hands the notification to each Property whose binding matches the account it names, under that Property's own Organization and connection.",
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/reporting/infrastructure/adapters/goal-program-subject-reader.ts',
    symbol: 'currentPortal',
    reason:
      "The Portal's owning Organization and Property are resolved by its id and the Portal is answered only when both equal the Goal Program's own.",
    category: 'TENANT-CHECKED',
  },
  {
    file: 'src/contexts/reporting/infrastructure/repositories/goal-program.repository.ts',
    symbol: 'listOperational',
    reason:
      'The bounded goal-maintenance scheduler intentionally lists scheduled and active Goal Programs across tenants, in tenant order, before tenant-preserving maintenance work.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/reporting/infrastructure/repositories/property-rating-goal.repository.ts',
    symbol: 'listActiveGoalScopes',
    reason:
      "The daily rating goal evaluation intentionally lists active Property Google rating goals across tenants, a bounded page in goal id order, returning only each goal's id, Organization and Property; every goal is then authorized and evaluated under its own Organization and Property.",
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-guest-voice-summary-schedule.adapter.ts',
    symbol: 'listDue',
    reason:
      "The hourly Monday-email sweep intentionally lists every Property with Review Analysis enabled across tenants, in Property id order, and keeps those whose own clock reads Monday morning; it returns only each Property's id and Organization, and every one is authorized under its own Organization and Property before anything of it is read.",
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/publication-reconciliation-candidate.repository.ts',
    symbol: 'findAmbiguousCandidates',
    reason:
      'The bounded publication-reconciliation scheduler intentionally lists ambiguous replies that are due across tenants and returns each with its Organization.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-discovery.repository.ts',
    symbol: 'findDuePropertiesBatch',
    reason:
      'The bounded review-discovery scheduler intentionally lists Properties due for a Google poll across tenants and returns each with its Organization and connection.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-discovery.repository.ts',
    symbol: 'pullLooksForward',
    reason:
      'The hourly content refresh sweep is tenant-cross by design: it hands over Property ids it read across tenants and moves only the due time of each Property sync state row, which is keyed by Property id and carries no Organization column.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-observation.repository.ts',
    symbol: 'lockStableIdentity',
    reason:
      'The stable Review row is locked by its id, and a row of another Organization, Property or platform is refused as a scope collision before the observation is applied.',
    category: 'TENANT-CHECKED',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'applyDeletionBatch',
    reason:
      'The snapshot worker addresses a run by its id; the run carries one Organization and Property, and every review it deletes is locked under that scope first.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'confirmLinkedCandidateMissing',
    reason:
      "The snapshot worker addresses a deletion candidate by its run and review ids, and the statement ties the review's provider subject to the run's Organization and Property.",
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'readNextLinkedCandidate',
    reason:
      "The snapshot worker reads the next deletion candidate of a run by the run id, and the statement ties the review to the run's Organization and Property.",
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'selectLockedDeletionReviews',
    reason:
      'Locks the review rows of one deletion batch by the ids its snapshot run selected; applyDeletionBatch has already locked each under the Organization and Property of the run.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/source-content-lifecycle-store.repository.ts',
    symbol: 'selectLockedLifecycleRows',
    reason:
      'Locks one page of review rows by the ids the content-lifecycle sweep selected across tenants, after the reply scope of each is locked under its own Organization, and returns each row with its Organization and Property.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/reputation/replies/scope-effects.server.ts',
    symbol: 'fenceReplyPublicationsAfterRestore',
    reason:
      'The existing restore recovery transaction intentionally fences in-flight Reply publications across every tenant. It runs only under the recovery authority and preserves the original cancellation and ambiguity predicates.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/reputation/replies/scope-effects.server.ts',
    symbol: 'lockReplyReviewsInScope',
    reason:
      'Locks Review rows before Reply effects in a caller-owned transaction. Its SQL scope comes only from named server commands: tenant-bound lifecycle and AI withdrawal scopes, or the existing global AI control and restore recovery authorities.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/reputation/replies/scope-effects.server.ts',
    symbol: 'withdrawAiDrafts',
    reason:
      'The existing AI control transition may withdraw stale AI drafts across tenants; Property, authorization and Review callers supply tenant predicates. Every affected Reply is correlated to its own Review tenant, and effects stay in the caller transaction.',
    category: 'LEGITIMATE-GLOBAL',
  },
] as const

// S12 — executable registry for reviewed tenant-free infrastructure queries.
//
// Every entry names the narrow query boundary that may omit an organization
// predicate. The tenant-predicate canary verifies that entries still point to a
// real callable and rejects unrecorded tenant-free repository queries.

export type TenantPredicateExemptionCategory =
  'LEGITIMATE-GLOBAL' | 'PUBLIC-TOKEN' | 'UNSCOPED-PENDING'

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
    file: 'src/contexts/activity/infrastructure/activity-recovery-store.ts',
    symbol: 'listMissing',
    reason:
      'The bounded replay-recovery scan intentionally inventories projection gaps across tenants and returns the replay authority with its tenant identity.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/activity/infrastructure/activity-recovery-store.ts',
    symbol: 'readGap',
    reason:
      'The recovery health snapshot intentionally aggregates replay-authority gaps across tenants without mutating any tenant-owned row.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-authorization-erasure.adapter.ts',
    symbol: 'claimNext',
    reason:
      'The bounded authorization-erasure worker claims the next lifecycle obligation globally; tenant identifiers remain inside the claimed repository transaction.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-authorization-erasure.adapter.ts',
    symbol: 'failActiveGenerationConflict',
    reason:
      'The erasure lifecycle transition is a lease-owner and attempt-fenced CAS over a globally claimed obligation, with tenant identifiers intentionally retained inside the transaction.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-authorization-erasure.adapter.ts',
    symbol: 'readBacklog',
    reason:
      'The operations health probe intentionally returns only aggregate authorization-erasure lifecycle counts across all tenants.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-authorization-erasure.adapter.ts',
    symbol: 'recordClaimFailure',
    reason:
      'Failure recording is a lease-owner and attempt-fenced CAS over a globally claimed erasure obligation; tenant identifiers never leave the repository transaction.',
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
    symbol: 'claimExecution',
    reason:
      'UNSCOPED-PENDING: src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts:554 — the port supplies only an operation UUID and attempt fence; propagate organization identity through the execution claim contract.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts',
    symbol: 'listExpiredExecutions',
    reason:
      'The bounded abandoned-execution sweep intentionally scans all tenants and every candidate is rechecked by an exact operation-attempt CAS before mutation.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts',
    symbol: 'markDelivered',
    reason:
      'UNSCOPED-PENDING: src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts:720 — the delivery contract supplies only an operation UUID and attempt; propagate organization identity to the terminal CAS.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts',
    symbol: 'read',
    reason:
      'UNSCOPED-PENDING: src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts:516 — the read port supplies operation UUID and command but no organization; propagate tenant identity from the calling execution context.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts',
    symbol: 'recordFailure',
    reason:
      'UNSCOPED-PENDING: src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts:621 — failure settlement is keyed by operation UUID and attempt only; add organization identity to the port and every caller.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts',
    symbol: 'duplicateResult',
    reason:
      'The globally unique event-envelope receipt is the idempotency authority and discovers the already-persisted lifecycle and enrollment rows for a replay.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts',
    symbol: 'linkedReplayOutcome',
    reason:
      'UNSCOPED-PENDING: src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts:1249 — reconciliation receives only enrollment identity; thread organization identity through the replay lookup.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts',
    symbol: 'markSuperseded',
    reason:
      'UNSCOPED-PENDING: src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts:1870 — the authorization fence omits organization identity; extend the enrollment terminal-write contract.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts',
    symbol: 'markTerminal',
    reason:
      'UNSCOPED-PENDING: src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts:1095 — this helper receives enrollment identity only; pass organization identity from its reconciliation callers.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts',
    symbol: 'readEnrollmentForUpdate',
    reason:
      'UNSCOPED-PENDING: src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts:1082 — the lock helper accepts only enrollment UUID; propagate organization identity from the enrollment workflow.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/goal/infrastructure/repositories/goal-program.repository.ts',
    symbol: 'hydrateBundles',
    reason:
      'The hydration query receives a finite set of already-authorized or globally scheduled program rows and loads children only through their globally unique parent IDs.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/goal/infrastructure/repositories/goal-program.repository.ts',
    symbol: 'listDueResults',
    reason:
      'The bounded goal-maintenance scheduler intentionally enumerates due result records across all tenants before tenant-preserving maintenance work.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/goal/infrastructure/repositories/goal.repository.ts',
    symbol: 'findAllActiveGlobal',
    reason:
      'This explicitly global scheduler read enumerates active goals across tenants and returns each record with its owning organization identity.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/goal/infrastructure/repositories/goal.repository.ts',
    symbol: 'findAllActiveRecurring',
    reason:
      'This explicitly global scheduler read enumerates active recurring root goals across tenants and preserves tenant identity on every result.',
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
      'The refusal-control health read intentionally aggregates permit outcomes across tenants by global capability and correlation identifiers only.',
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
    symbol: 'hasActiveCleanupWork',
    reason:
      'The global capability-control transaction must detect any outstanding credential cleanup across tenants before completing its fence transition.',
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
    file: 'src/contexts/identity/infrastructure/repositories/google-content-authority.repository.ts',
    symbol: 'lockPermit',
    reason:
      'UNSCOPED-PENDING: src/contexts/identity/infrastructure/repositories/google-content-authority.repository.ts:537 — the lock helper accepts only permit UUID; pass organization identity from the permit workflow.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/inbox/infrastructure/feedback-handling.store.ts',
    symbol: 'historyFor',
    reason:
      'UNSCOPED-PENDING: src/contexts/inbox/infrastructure/feedback-handling.store.ts:221 — the history helper receives inbox item and cycle identifiers only; propagate organization identity from the handling command.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/inbox/infrastructure/handling-cycle-transitions.read.ts',
    symbol: 'selectCycleCloseReason',
    reason:
      'UNSCOPED-PENDING: src/contexts/inbox/infrastructure/handling-cycle-transitions.read.ts:39 — the transition helper receives inbox item and cycle identifiers only; add organization identity to its reader contract.',
    category: 'UNSCOPED-PENDING',
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
    symbol: 'insertDurableImportRecords',
    reason:
      'Durable import records are keyed by opaque reference and invalidation digests whose global uniqueness prevents cross-tenant reference collisions.',
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
    file: 'src/contexts/integration/infrastructure/repositories/credential-lifecycle.repository.ts',
    symbol: 'expireDeadlines',
    reason:
      'The bounded credential lifecycle sweep intentionally expires elapsed revoke permits across tenants under the global cleanup authority.',
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
    file: 'src/contexts/integration/infrastructure/repositories/google-oauth-exchange-recovery.repository.ts',
    symbol: 'expire',
    reason:
      'The bounded OAuth recovery sweep intentionally expires abandoned exchange attempts across tenants under the global recovery authority.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/metric/infrastructure/repositories/property-local-date.ts',
    symbol: 'createPropertyLocalDateResolver',
    reason:
      'UNSCOPED-PENDING: src/contexts/metric/infrastructure/repositories/property-local-date.ts:23 — the resolver accepts property UUID only; propagate organization identity from metric projection callers.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/notification/infrastructure/repositories/notification-gap.repository.ts',
    symbol: 'countItemsMissingNotifications',
    reason:
      'The bounded health gauge intentionally counts notification gaps across all tenants and returns no tenant-owned content or identifiers.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/notification/infrastructure/repositories/notification-gap.repository.ts',
    symbol: 'findItemsMissingNotifications',
    reason:
      'The bounded notification-repair scan searches all tenant inbox projections and returns each row with its tenant identifiers for scoped repair.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/notification/infrastructure/repositories/one-click-unsubscribe.repository.ts',
    symbol: 'targetScopes',
    reason:
      'A signed one-click unsubscribe token identifies the queue target before tenant scope is known, and this lookup derives every affected tenant scope.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/portal/infrastructure/portal-upload-issuance-store.ts',
    symbol: 'listSourceCleanupCandidates',
    reason:
      'The bounded source-cleanup scheduler intentionally enumerates expired upload issuances across tenants and retains their owning scope for cleanup.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/portal/infrastructure/repositories/link-resolver.repository.ts',
    symbol: 'resolveLinkById',
    reason:
      'Unauthenticated guest resolution uses the unguessable link UUID as its capability token and discovers tenant scope from the resolved row.',
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
    file: 'src/contexts/portal/infrastructure/repositories/portal-token.repository.ts',
    symbol: 'findResolvableByDigest',
    reason:
      'The public Portal token digest is the capability presented before tenant identity is known, so the lookup derives scope from the token row.',
    category: 'PUBLIC-TOKEN',
  },
  {
    file: 'src/contexts/property/infrastructure/property-erase-command-store.ts',
    symbol: 'confirm',
    reason:
      'UNSCOPED-PENDING: src/contexts/property/infrastructure/property-erase-command-store.ts:170 — confirmation receives only authority UUID; propagate organization identity through the erase command contract.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/property/infrastructure/property-erase-command-store.ts',
    symbol: 'load',
    reason:
      'UNSCOPED-PENDING: src/contexts/property/infrastructure/property-erase-command-store.ts:121 — authority loading accepts only authority UUID; require organization identity from callers.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/property/infrastructure/property-erase-command-store.ts',
    symbol: 'nextAdvanceable',
    reason:
      'The globally serialized erase worker intentionally claims exactly one advanceable authority across tenants and returns its complete tenant identity.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/property/infrastructure/property-erase-command-store.ts',
    symbol: 'recordPreview',
    reason:
      'UNSCOPED-PENDING: src/contexts/property/infrastructure/property-erase-command-store.ts:150 — preview recording receives only authority UUID; propagate organization identity through the erase command contract.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/property/infrastructure/property-google-binding-store.ts',
    symbol: 'countUnreleasedExpired',
    reason:
      'The bounded retention gauge intentionally counts expired unreleased operation receipts across tenants without returning tenant-owned content.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/property/infrastructure/property-google-binding-store.ts',
    symbol: 'sweepReleasedExpired',
    reason:
      'The bounded retention sweep intentionally removes released expired operation receipts across tenants after their retention authority is released.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/property/infrastructure/property-routing.adapter.ts',
    symbol: 'createPropertyRoutingLoader',
    reason:
      'UNSCOPED-PENDING: src/contexts/property/infrastructure/property-routing.adapter.ts:20 — routing resolution accepts only property UUID; propagate organization identity from every routing caller.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/property/infrastructure/repositories/property.repository.ts',
    symbol: 'findBySlug',
    reason:
      'UNSCOPED-PENDING: src/contexts/property/infrastructure/repositories/property.repository.ts:204 — slugs are unique only within an organization; require organization identity at the repository boundary.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/property/infrastructure/repositories/reconcile-regions.repository.ts',
    symbol: 'applyRegionReconciliation',
    reason:
      'The operator reconciliation intentionally applies a reviewed global or explicit regional scope and recomputes every candidate immediately before mutation.',
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
    symbol: 'beginConfirmationScan',
    reason:
      'UNSCOPED-PENDING: src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts:1029 — the snapshot phase contract supplies run UUID only; propagate organization identity from the orchestrator.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'commitPage',
    reason:
      'UNSCOPED-PENDING: src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts:782 — page commits supply run UUID but no organization identity; extend the snapshot commit contract.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'expireRawSourceBatch',
    reason:
      'The bounded compatibility lifecycle read intentionally translates a global review-expiry cursor before delegating to the canonical purge authority.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'failRun',
    reason:
      'UNSCOPED-PENDING: src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts:1144 — failure settlement supplies run UUID only; propagate organization identity through the repository port.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'finishConfirmationScan',
    reason:
      'UNSCOPED-PENDING: src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts:1060 — confirmation completion supplies run UUID only; propagate organization identity from the orchestrator.',
    category: 'UNSCOPED-PENDING',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts',
    symbol: 'recordCandidateObservation',
    reason:
      'UNSCOPED-PENDING: src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts:999 — candidate observation supplies run UUID and provider review only; carry organization identity in the port input.',
    category: 'UNSCOPED-PENDING',
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
    symbol: 'findExpiredBatchBeforeAcrossTenants',
    reason:
      'The bounded review-content purge sweep intentionally scans all tenants by a stable expiration cursor so every eligible row can be retired.',
    category: 'LEGITIMATE-GLOBAL',
  },
  {
    file: 'src/contexts/review/infrastructure/repositories/review.repository.ts',
    symbol: 'findExpiringBatchAcrossTenants',
    reason:
      'The bounded review-content lifecycle sweep intentionally scans expiration candidates across all tenants and preserves tenant identity on every result.',
    category: 'LEGITIMATE-GLOBAL',
  },
] as const

const BY_QUERY: Readonly<Record<string, true>> = Object.fromEntries(
  TENANT_PREDICATE_EXEMPTIONS.map((entry) => [`${entry.file}#${entry.symbol}`, true]),
)

export function isTenantPredicateExempt(file: string, symbol: string): boolean {
  return BY_QUERY[`${file}#${symbol}`] === true
}

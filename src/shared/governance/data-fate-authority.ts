/**
 * Persisted-model lifecycle authority (FND-02).
 *
 * A hidden route or denied capability says nothing about the rows already in
 * PostgreSQL. This catalogue therefore classifies every Drizzle `pgTable`
 * export independently of UI/runtime reachability. The companion guard scans
 * the schema directory in both directions, so a new or removed table must make
 * an explicit lifecycle decision here.
 */

export type DataFateDisposition =
  | 'active_authority'
  | 'compatibility_read'
  | 'quarantined_reconciliation_input'
  | 'erasable_source_content'
  | 'recoverable_archive'
  | 'bounded_contraction'

export type DataFateOwner =
  | 'activity'
  | 'ai'
  | 'dashboard'
  | 'goal'
  | 'guest'
  | 'identity'
  | 'inbox'
  | 'integration'
  | 'metric'
  | 'notification'
  | 'platform'
  | 'portal'
  | 'property'
  | 'review'
  | 'staff'

export type DataFateRow = Readonly<{
  schemaFile: string
  exportName: string
  owner: DataFateOwner
  disposition: DataFateDisposition
  /** Package or accepted authority responsible for this decision. */
  authority: string
  /** Required for every non-active row; names the condition that bounds it. */
  exitCriteria: string
}>

type DataFateGroup = Readonly<{
  schemaFile: string
  exportNames: ReadonlyArray<string>
  owner: DataFateOwner
  disposition: DataFateDisposition
  authority: string
  exitCriteria?: string
}>

export function dataFateKey(schemaFile: string, exportName: string): string {
  return `${schemaFile}#${exportName}`
}

function rows(group: DataFateGroup): readonly DataFateRow[] {
  return group.exportNames.map((exportName) =>
    Object.freeze({
      schemaFile: group.schemaFile,
      exportName,
      owner: group.owner,
      disposition: group.disposition,
      authority: group.authority,
      exitCriteria: group.exitCriteria ?? '',
    }),
  )
}

const CONTRACT_AFTER_EXPORT =
  'Inventory and reconcile every row, retain an export/restore proof, prove zero active readers and writers, then contract through an expand/backfill/contract migration.'

const ERASE_WITH_OWNER =
  'The owning lifecycle command must hide, erase, or expire the content with content-free completion evidence and restore-boundary verification.'

const RETAINED_HISTORY =
  'Retain as immutable history while its owning aggregate is active or archived; include it in scoped export, restore, retention, and erasure evidence.'

const COMPATIBILITY_EXIT =
  'Keep read-only during replacement parity; remove after canonical readers, restore tooling, and historical reconciliation no longer depend on it.'

/**
 * Grouping keeps the authority reviewable without weakening exhaustiveness:
 * every table export is still named exactly once, and the filesystem guard
 * rejects inherited defaults or wildcard classifications.
 */
export const DATA_FATE_AUTHORITY = Object.freeze([
  ...rows({
    schemaFile: 'activity.schema.ts',
    exportNames: ['recentActivityEntries'],
    owner: 'activity',
    disposition: 'recoverable_archive',
    authority: 'ACT-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'beta-feedback-triage.schema.ts',
    exportNames: ['betaFeedbackTriage'],
    owner: 'identity',
    disposition: 'active_authority',
    authority: 'OBS-01',
  }),
  ...rows({
    schemaFile: 'beta-feedback-triage.schema.ts',
    exportNames: ['betaFeedbackTriageTransitions'],
    owner: 'identity',
    disposition: 'recoverable_archive',
    authority: 'OBS-01',
    exitCriteria:
      'Content-free triage transition evidence is retained through support response, incident/privacy handling, scoped export/restore, and the counsel-approved support retention horizon; no destructive lifecycle is active before approval.',
  }),
  ...rows({
    schemaFile: 'organization-lifecycle.schema.ts',
    exportNames: ['organizationLifecycleEvents'],
    owner: 'platform',
    disposition: 'recoverable_archive',
    authority: 'LIF-01',
    exitCriteria:
      'Content-free Organization lifecycle, command, Property erase, privacy-transition, and backup hold-release events are retained through retry/recovery and the applicable legal evidence horizon. No destructive event lifecycle is active.',
  }),
  ...rows({
    schemaFile: 'activity.schema.ts',
    exportNames: ['recentActivityActorLabelRedactions', 'recentActivityReplayFacts'],
    owner: 'activity',
    disposition: 'active_authority',
    authority: 'ACT-01/ARC-01',
  }),
  ...rows({
    schemaFile: 'activity.schema.ts',
    exportNames: ['operationalActionHistoryHeads', 'operationalActionHistoryLegalHolds'],
    owner: 'activity',
    disposition: 'active_authority',
    authority: 'ACT-01/ADR-0056',
  }),
  ...rows({
    schemaFile: 'activity.schema.ts',
    exportNames: ['operationalActionHistoryRecords'],
    owner: 'activity',
    disposition: 'recoverable_archive',
    authority: 'ACT-01/ADR-0056',
    exitCriteria:
      'Retain append-oriented action records and honor legal holds. The proposed 365-day horizon remains report-only until counsel approves a destructive lifecycle authority and restore/export evidence.',
  }),
  ...rows({
    schemaFile: 'ai.schema.ts',
    exportNames: [
      'aiExecutionControlHeads',
      'aiExecutionControlTransitions',
      'aiOperations',
      'aiOrganizationCostWindows',
      'aiPropertyProcessingProfiles',
      'aiPropertyTrendSchedulerHeads',
      'aiPropertyTrendSchedules',
      'aiReviewAnalysisEnrollments',
    ],
    owner: 'ai',
    disposition: 'active_authority',
    authority: 'AI-01/AI-02/AI-04',
  }),
  ...rows({
    schemaFile: 'ai.schema.ts',
    exportNames: [
      'aiPropertyAggregateContributions',
      'aiPropertyAggregateHeads',
      'aiPropertyDailyAggregates',
      'aiPropertyTrendOutcomes',
      'aiReviewAnalyses',
    ],
    owner: 'ai',
    disposition: 'erasable_source_content',
    authority: 'AI-01/AI-02/AI-04',
    exitCriteria: ERASE_WITH_OWNER,
  }),
  ...rows({
    schemaFile: 'audit.ts',
    exportNames: ['auditLogs'],
    owner: 'activity',
    disposition: 'recoverable_archive',
    authority: 'ACT-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'auth.ts',
    exportNames: [
      'account',
      'invitation',
      'member',
      'organization',
      'organizationRole',
      'session',
      'user',
      'verification',
    ],
    owner: 'identity',
    disposition: 'active_authority',
    authority: 'SAFE-02/PPL-01',
  }),
  ...rows({
    schemaFile: 'dac.schema.ts',
    exportNames: ['organizationRolePolicy', 'permissionVersion'],
    owner: 'identity',
    disposition: 'active_authority',
    authority: 'SAFE-02/PPL-01',
  }),
  ...rows({
    schemaFile: 'dashboard.schema.ts',
    exportNames: ['setupChecklistMilestones'],
    owner: 'dashboard',
    disposition: 'active_authority',
    authority: 'EXP-01',
  }),
  ...rows({
    schemaFile: 'goal.schema.ts',
    exportNames: ['goalMonthlyResults', 'goalPrograms', 'goalSubjectAssignments'],
    owner: 'goal',
    disposition: 'active_authority',
    authority: 'GOA-01',
  }),
  ...rows({
    schemaFile: 'goal.schema.ts',
    exportNames: ['goalProgramVersions', 'goalResultRevisions'],
    owner: 'goal',
    disposition: 'recoverable_archive',
    authority: 'GOA-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'google-connection.schema.ts',
    exportNames: ['googleConnections'],
    owner: 'integration',
    disposition: 'active_authority',
    authority: 'GGL-01/SAFE-04',
  }),
  ...rows({
    schemaFile: 'google-content-control.schema.ts',
    exportNames: [
      'authorizationExecutionPermits',
      'capabilityExecutionControl',
      'credentialRevokePermits',
      'googleCredentialSourceOperations',
      'googleSubjectAuthorityGuards',
    ],
    owner: 'integration',
    disposition: 'active_authority',
    authority: 'SAFE-04/GGL-01',
  }),
  ...rows({
    schemaFile: 'google-import-v2.schema.ts',
    exportNames: ['gbpImportRequestItems', 'gbpImportRequests', 'gbpImportSagas'],
    owner: 'integration',
    disposition: 'active_authority',
    authority: 'GGL-01',
  }),
  ...rows({
    schemaFile: 'google-import-discovery.schema.ts',
    exportNames: ['googleImportDiscoveryRecords'],
    owner: 'integration',
    disposition: 'erasable_source_content',
    authority: 'GGL-01/SAFE-04/LIF-01',
    exitCriteria:
      'Delete provider discovery content on redemption or authorization invalidation and no later than its database-enforced 24-hour expiry; retain content-free purge evidence.',
  }),
  ...rows({
    schemaFile: 'guest.schema.ts',
    exportNames: ['feedback', 'ratings', 'scanEvents'],
    owner: 'guest',
    disposition: 'compatibility_read',
    authority: 'GST-01/MET-01/CNV-01',
    exitCriteria: COMPATIBILITY_EXIT,
  }),
  ...rows({
    schemaFile: 'guest.schema.ts',
    exportNames: [
      'guestNetworkPressureRecords',
      'guestQualifiedScans',
      'guestResponseExperienceSnapshots',
      'guestResponseIntegrityDecisions',
      'guestResponseSessionBindings',
      'guestResponses',
    ],
    owner: 'guest',
    disposition: 'active_authority',
    authority: 'GST-01',
  }),
  ...rows({
    schemaFile: 'guest.schema.ts',
    exportNames: ['guestContactRequestRevealAudits'],
    owner: 'guest',
    disposition: 'recoverable_archive',
    authority: 'GST-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'guest.schema.ts',
    exportNames: ['guestContactRequests', 'guestResponsePrivateFeedback'],
    owner: 'guest',
    disposition: 'erasable_source_content',
    authority: 'GST-01/LIF-01',
    exitCriteria: ERASE_WITH_OWNER,
  }),
  ...rows({
    schemaFile: 'inbox.schema.ts',
    exportNames: [
      'inboxAssignmentHistory',
      'inboxHandlingCycleHeads',
      'inboxHandlingCycleResponseTargets',
      'inboxHandlingCycles',
      'inboxItems',
      'inboxNotes',
      'inboxPrivateFeedbackTargetPropertyOverrides',
      'inboxResponseTargetOrganizationPolicies',
      'inboxResponseTargetReminders',
      'inboxUserViews',
    ],
    owner: 'inbox',
    disposition: 'active_authority',
    authority: 'IBX-01',
  }),
  ...rows({
    schemaFile: 'inbox.schema.ts',
    exportNames: [
      'inboxEscalationHistory',
      'inboxFeedbackHandlingOutcomes',
      'inboxHandlingCycleTransitions',
    ],
    owner: 'inbox',
    disposition: 'recoverable_archive',
    authority: 'IBX-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'merchant-ai-authorization.schema.ts',
    exportNames: ['merchantAiEnablement'],
    owner: 'ai',
    disposition: 'active_authority',
    authority: 'AI-01',
  }),
  ...rows({
    schemaFile: 'merchant-ai-authorization.schema.ts',
    exportNames: ['merchantAiConsentEvidence'],
    owner: 'ai',
    disposition: 'recoverable_archive',
    authority: 'AI-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'metric.schema.ts',
    exportNames: [
      'metricCorrections',
      'metricReadings',
      'metricCurrentGoogleReputationSnapshots',
      'portalMetricLifetimeAggregates',
    ],
    owner: 'metric',
    disposition: 'active_authority',
    authority: 'MET-01',
  }),
  ...rows({
    schemaFile: 'notification.schema.ts',
    exportNames: [
      'notificationDigestBatchMembers',
      'notificationDigestBatches',
      'notificationEmailQueue',
      'notificationPreferences',
      'notificationUserSettings',
      'notifications',
    ],
    owner: 'notification',
    disposition: 'active_authority',
    authority: 'NTF-01',
  }),
  ...rows({
    schemaFile: 'backup-erasure-ledger.schema.ts',
    exportNames: ['backupErasureLedger'],
    owner: 'identity',
    disposition: 'recoverable_archive',
    authority: 'LIF-01',
    exitCriteria:
      'Content-free evidence that must OUTLIVE the data it describes: the restore resurrection fence replays these entries before a restored cell may be declared verified, so erasing the ledger would let purged data come back through a restore. Retained until counsel approves a retention horizon that is strictly longer than the longest backup retention window.',
  }),
  ...rows({
    schemaFile: 'property-erase.schema.ts',
    exportNames: ['propertyEraseAuthorities'],
    owner: 'property',
    disposition: 'recoverable_archive',
    authority: 'LIF-01',
    exitCriteria:
      'Content-free authority for an irreversible erase is the proof that the erase was independently authorized, so it outlives the erased Property. Contract only after counsel approves an evidence retention horizon.',
  }),
  ...rows({
    schemaFile: 'privacy-request.schema.ts',
    exportNames: ['privacyRequests'],
    owner: 'identity',
    disposition: 'recoverable_archive',
    authority: 'LIF-01',
    exitCriteria:
      'Content-free privacy-request authority names the subject only by the SHA-256 of a verified identifier, never in the clear. Retained until counsel approves a data-subject-request evidence horizon.',
  }),
  ...rows({
    schemaFile: 'organization-lifecycle.schema.ts',
    exportNames: ['organizationExports', 'organizationLifecycleAuthority'],
    owner: 'identity',
    disposition: 'active_authority',
    authority: 'LIF-01',
  }),
  ...rows({
    schemaFile: 'organization-lifecycle.schema.ts',
    exportNames: ['organizationExportRetrievalIssuances'],
    owner: 'identity',
    disposition: 'recoverable_archive',
    authority: 'LIF-01',
    exitCriteria:
      'Digest-only export retrieval issuances permanently retire old token authorities through retry/recovery and the approved evidence horizon. No destructive issuance lifecycle is active.',
  }),
  ...rows({
    schemaFile: 'outbox.schema.ts',
    exportNames: ['eventConsumerReceipts', 'idempotencyReceipts', 'outboxEvents'],
    owner: 'platform',
    disposition: 'active_authority',
    authority: 'ARC-01',
  }),
  ...rows({
    schemaFile: 'people-access.schema.ts',
    exportNames: [
      'portalGroupMemberships',
      'portalResponsibilities',
      'staffParticipants',
      'staffParticipations',
      'staffUserLinks',
    ],
    owner: 'staff',
    disposition: 'active_authority',
    authority: 'PPL-01',
  }),
  ...rows({
    schemaFile: 'people-access.schema.ts',
    exportNames: ['propertyAccessGrants'],
    owner: 'identity',
    disposition: 'bounded_contraction',
    authority: 'PPL-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
  }),
  ...rows({
    schemaFile: 'policy.schema.ts',
    exportNames: ['policyConsent', 'propertyAccessGrant'],
    owner: 'identity',
    disposition: 'active_authority',
    authority: 'SAFE-02/PPL-01',
  }),
  ...rows({
    schemaFile: 'portal-group.schema.ts',
    exportNames: ['portalGroups'],
    owner: 'portal',
    disposition: 'active_authority',
    authority: 'POR-01',
  }),
  ...rows({
    schemaFile: 'portal.schema.ts',
    exportNames: [
      'portalAccessArtifacts',
      'portalApprovedDestinations',
      'portalLinkCategories',
      'portalLinks',
      'portalResponsibleManagers',
      'portalTokens',
      'portalUploadIssuances',
      'portals',
    ],
    owner: 'portal',
    disposition: 'active_authority',
    authority: 'POR-01/SAFE-01',
  }),
  ...rows({
    schemaFile: 'portal.schema.ts',
    exportNames: [
      'portalHealthIntervals',
      'portalPendingContentChanges',
      'portalPublicationActivations',
      'portalPublicationSnapshots',
    ],
    owner: 'portal',
    disposition: 'recoverable_archive',
    authority: 'POR-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'portal.schema.ts',
    exportNames: ['portalGroupMembers'],
    owner: 'portal',
    disposition: 'compatibility_read',
    authority: 'POR-01/PPL-01/CNV-01',
    exitCriteria: COMPATIBILITY_EXIT,
  }),
  ...rows({
    schemaFile: 'portal.schema.ts',
    exportNames: [
      'portalLocalizedOverrides',
      'propertyPortalBrandContents',
      'propertyPortalBrandProfiles',
    ],
    owner: 'portal',
    disposition: 'erasable_source_content',
    authority: 'POR-01/LIF-01',
    exitCriteria: ERASE_WITH_OWNER,
  }),
  ...rows({
    schemaFile: 'property.schema.ts',
    exportNames: ['properties', 'propertyResponsibleManagers'],
    owner: 'property',
    disposition: 'active_authority',
    authority: 'PPL-01/LIF-01',
  }),
  ...rows({
    schemaFile: 'recovery.schema.ts',
    exportNames: ['recoveryRuns', 'reviewLifecycleRecoveryExecutions'],
    owner: 'platform',
    disposition: 'recoverable_archive',
    authority: 'SAFE-03/REG-04/REV-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'review-sync.schema.ts',
    exportNames: [
      'retentionRuns',
      'reviewRefreshRuns',
      'reviewSyncRuns',
      'reviewSyncState',
    ],
    owner: 'review',
    disposition: 'active_authority',
    authority: 'GGL-01/REV-01/ARC-02',
  }),
  ...rows({
    schemaFile: 'review.schema.ts',
    exportNames: [
      'googleReplyObservationHeads',
      'replies',
      'replyPublicationAttempts',
      'replyPublicationAuthorizations',
      'reviewAiAnalysisHeads',
      'reviewProviderDeletionCandidates',
      'reviewProviderSnapshotRuns',
      'reviewProviderSubjectHmacKeyVersions',
      'reviewProviderSubjects',
      'reviews',
    ],
    owner: 'review',
    disposition: 'active_authority',
    authority: 'REV-01/RPL-01',
  }),
  ...rows({
    schemaFile: 'review.schema.ts',
    exportNames: [
      'googleReplyObservations',
      'materialReviewRevisions',
      'reviewGoogleReputationSnapshotFacts',
      'reviewProviderSnapshotMembers',
      'reviewSourceObservations',
    ],
    owner: 'review',
    disposition: 'recoverable_archive',
    authority: 'REV-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'review.schema.ts',
    exportNames: ['reviewSourceContents'],
    owner: 'review',
    disposition: 'erasable_source_content',
    authority: 'REV-01/LIF-01',
    exitCriteria: ERASE_WITH_OWNER,
  }),
] satisfies ReadonlyArray<DataFateRow>)

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

const RECONCILE_QUARANTINE =
  'Resolve every row to an accepted canonical record or a reviewed terminal disposition; quarantine rows never become product truth directly.'

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
    exportNames: ['activityLog'],
    owner: 'activity',
    disposition: 'recoverable_archive',
    authority: 'ACT-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'ai.schema.ts',
    exportNames: [
      'aiAdmissionCostReservations',
      'aiAdmissionProductConsumptions',
      'aiAdmissionRateWindows',
      'aiCanaryAuthorizationHeads',
      'aiCanaryAuthorizations',
      'aiExecutionControlHeads',
      'aiExecutionControlTransitions',
      'aiExecutionPermitSettlements',
      'aiExecutionPermits',
      'aiGovernancePolicies',
      'aiOperationAttempts',
      'aiOperationProfiles',
      'aiOperations',
      'aiOrganizationCostWindows',
      'aiProductVolumeConsumptions',
      'aiPropertyCalendarAuthorities',
      'aiPropertyProcessingProfiles',
      'aiPropertyQuotaWindows',
      'aiPropertyTrendSchedulerHeads',
      'aiPropertyTrendSchedules',
      'aiProviderCircuitStates',
      'aiProviderDeploymentCapabilities',
      'aiProviderDeploymentProfiles',
      'aiReadBarrierHeads',
      'aiReviewAnalysisBackfillRunMemberships',
      'aiReviewAnalysisBackfillRuns',
      'aiReviewEventCursors',
      'aiRoutingPolicies',
      'aiRuntimeCapabilityProfiles',
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
      'aiReviewAnalysisOutcomes',
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
    schemaFile: 'badge.schema.ts',
    exportNames: [
      'badgeAwards',
      'badgeDefinitionVersions',
      'badgeDefinitions',
      'governedBadgeAwardStatusFacts',
      'governedBadgeAwards',
      'organizationBadgeEnablements',
    ],
    owner: 'staff',
    disposition: 'bounded_contraction',
    authority: 'REC-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
  }),
  ...rows({
    schemaFile: 'dac.schema.ts',
    exportNames: ['organizationRolePolicy', 'permissionVersion'],
    owner: 'identity',
    disposition: 'active_authority',
    authority: 'SAFE-02/PPL-01',
  }),
  ...rows({
    schemaFile: 'goal.schema.ts',
    exportNames: ['goals', 'goalProgress'],
    owner: 'goal',
    disposition: 'bounded_contraction',
    authority: 'GOA-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
  }),
  ...rows({
    schemaFile: 'goal.schema.ts',
    exportNames: [
      'goalDefinitions',
      'goalEvaluations',
      'goalMonthlyResults',
      'goalPeriods',
      'goalPrograms',
      'goalRefreshReceipts',
      'goalSubjectAssignments',
      'goalTimezoneEventReceipts',
    ],
    owner: 'goal',
    disposition: 'active_authority',
    authority: 'GOA-01',
  }),
  ...rows({
    schemaFile: 'goal.schema.ts',
    exportNames: ['goalDefinitionVersions', 'goalProgramVersions', 'goalResultRevisions'],
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
      'capabilityComplianceApprovals',
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
    schemaFile: 'google-import-compatibility.schema.ts',
    exportNames: ['gbpImportLegacyHistory', 'legacyGbpCache', 'legacyGbpImportJobs'],
    owner: 'integration',
    disposition: 'compatibility_read',
    authority: 'GGL-01/CNV-01',
    exitCriteria: COMPATIBILITY_EXIT,
  }),
  ...rows({
    schemaFile: 'google-import-compatibility.schema.ts',
    exportNames: ['legacyImportControl', 'legacyImportEffectLeases'],
    owner: 'integration',
    disposition: 'bounded_contraction',
    authority: 'GGL-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
  }),
  ...rows({
    schemaFile: 'google-import-v2.schema.ts',
    exportNames: [
      'gbpImportItemRetryReceipts',
      'gbpImportRequestItems',
      'gbpImportRequests',
      'gbpImportSagas',
    ],
    owner: 'integration',
    disposition: 'active_authority',
    authority: 'GGL-01',
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
      'guestDestinationActionReceipts',
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
    exportNames: ['guestResponseMedia'],
    owner: 'guest',
    disposition: 'quarantined_reconciliation_input',
    authority: 'SAFE-01/GST-01',
    exitCriteria:
      'Guest media stays beta-disabled; inventory and purge orphaned objects, then migrate only through issued capability storage before any future activation.',
  }),
  ...rows({
    schemaFile: 'guest.schema.ts',
    exportNames: ['guestResponsePrivateFeedback'],
    owner: 'guest',
    disposition: 'erasable_source_content',
    authority: 'GST-01/LIF-01',
    exitCriteria: ERASE_WITH_OWNER,
  }),
  ...rows({
    schemaFile: 'identity-governance.schema.ts',
    exportNames: ['identityInvitationFactContract', 'userOrganizationBindings'],
    owner: 'identity',
    disposition: 'active_authority',
    authority: 'SAFE-02/PPL-01',
  }),
  ...rows({
    schemaFile: 'inbox.schema.ts',
    exportNames: [
      'inboxHandlingCycleHeads',
      'inboxHandlingCycles',
      'inboxItems',
      'inboxNotes',
      'inboxUserViews',
    ],
    owner: 'inbox',
    disposition: 'active_authority',
    authority: 'IBX-01',
  }),
  ...rows({
    schemaFile: 'leaderboard.schema.ts',
    exportNames: [
      'leaderboardEntries',
      'leaderboardSnapshots',
      'recognitionActivationGroups',
      'recognitionActivations',
      'recognitionBoardEntries',
      'recognitionBoardSnapshots',
      'recognitionReconciliationEvents',
    ],
    owner: 'staff',
    disposition: 'bounded_contraction',
    authority: 'REC-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
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
      'metricDefinitionVersions',
      'metricDefinitions',
      'metricReadings',
      'metricSourceWatermarks',
    ],
    owner: 'metric',
    disposition: 'active_authority',
    authority: 'MET-01',
  }),
  ...rows({
    schemaFile: 'metric.schema.ts',
    exportNames: ['metricQuarantine'],
    owner: 'metric',
    disposition: 'quarantined_reconciliation_input',
    authority: 'MET-01',
    exitCriteria: RECONCILE_QUARANTINE,
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
    schemaFile: 'notification.schema.ts',
    exportNames: [
      'notificationGovernanceQuarantine',
      'notificationPreferenceGovernanceQuarantine',
    ],
    owner: 'notification',
    disposition: 'quarantined_reconciliation_input',
    authority: 'NTF-01',
    exitCriteria: RECONCILE_QUARANTINE,
  }),
  ...rows({
    schemaFile: 'outbox.schema.ts',
    exportNames: ['eventConsumerReceipts', 'outboxEvents'],
    owner: 'platform',
    disposition: 'active_authority',
    authority: 'ARC-01',
  }),
  ...rows({
    schemaFile: 'people-access.schema.ts',
    exportNames: [
      'portalGroupMemberships',
      'portalResponsibilities',
      'propertyAccessGrants',
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
    exportNames: ['teamMemberships', 'teamPortalGroupScopes'],
    owner: 'staff',
    disposition: 'bounded_contraction',
    authority: 'PPL-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
  }),
  ...rows({
    schemaFile: 'policy.schema.ts',
    exportNames: [
      'organizationCapability',
      'organizationPolicy',
      'policyConsent',
      'policyVersion',
      'propertyCapability',
      'propertyPolicy',
    ],
    owner: 'identity',
    disposition: 'active_authority',
    authority: 'SAFE-02/PPL-01',
  }),
  ...rows({
    schemaFile: 'policy.schema.ts',
    exportNames: ['policyDecisionAudit'],
    owner: 'identity',
    disposition: 'recoverable_archive',
    authority: 'SAFE-02/PPL-01',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'policy.schema.ts',
    exportNames: ['propertyAccessGrant'],
    owner: 'identity',
    disposition: 'compatibility_read',
    authority: 'PPL-01/CNV-01',
    exitCriteria: COMPATIBILITY_EXIT,
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
    exportNames: ['portalPublicationActivations', 'portalPublicationSnapshots'],
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
    schemaFile: 'property-operation-receipt.schema.ts',
    exportNames: ['propertyOperationReceipts'],
    owner: 'property',
    disposition: 'active_authority',
    authority: 'PPL-01/POR-01',
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
    exportNames: ['recoveryRuns'],
    owner: 'platform',
    disposition: 'recoverable_archive',
    authority: 'REG-04',
    exitCriteria: RETAINED_HISTORY,
  }),
  ...rows({
    schemaFile: 'region-move.schema.ts',
    exportNames: ['regionMoves'],
    owner: 'platform',
    disposition: 'active_authority',
    authority: 'REG-01/REG-02',
  }),
  ...rows({
    schemaFile: 'review-sync.schema.ts',
    exportNames: [
      'inboundWebhookReceipts',
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
      'replies',
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
      'materialReviewRevisions',
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
  ...rows({
    schemaFile: 'review.schema.ts',
    exportNames: ['reviewSourceProvenanceQuarantine'],
    owner: 'review',
    disposition: 'quarantined_reconciliation_input',
    authority: 'REV-01',
    exitCriteria: RECONCILE_QUARANTINE,
  }),
  ...rows({
    schemaFile: 'rollup.schema.ts',
    exportNames: [
      'rollupDailyInboxMetrics',
      'rollupDailyMetrics',
      'rollupWatermarks',
      'rollupWeeklyMetrics',
    ],
    owner: 'metric',
    disposition: 'bounded_contraction',
    authority: 'MET-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
  }),
  ...rows({
    schemaFile: 'staff-assignment.schema.ts',
    exportNames: ['staffAssignments'],
    owner: 'staff',
    disposition: 'bounded_contraction',
    authority: 'PPL-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
  }),
  ...rows({
    schemaFile: 'team.schema.ts',
    exportNames: ['teams'],
    owner: 'staff',
    disposition: 'bounded_contraction',
    authority: 'PPL-01/CNV-01',
    exitCriteria: CONTRACT_AFTER_EXPORT,
  }),
] satisfies ReadonlyArray<DataFateRow>)

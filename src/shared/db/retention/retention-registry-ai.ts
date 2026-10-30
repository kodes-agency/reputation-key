/**
 * The registry rules for Review Analysis v3 derivatives (migration 0078). The
 * accepted Privacy Notice keeps a de-identified AI insight for 24 months, and
 * decision 16 of the v3 contract is that nothing v3 stores goes active without
 * a deletion rule that is executed and tested.
 *
 * Seven tables, three executing rules:
 *
 * - `ai_review_analyses.v3_expired` deletes a v3 analysis on the `expires_at`
 *   it stamped at generation. Everything else v3 stores about an analysis
 *   cascades from it: its mention rows, the sentence numbers each cites, its
 *   aggregate contribution and that contribution's mention rows. Each of those
 *   has an entry below so the registry names every table, and
 *   `ai-review-analysis-v3-retention.test.ts` proves from the schema that every
 *   one of them is removed by a cascade from a table a rule executes.
 * - `ai_property_review_population_daily.expired` deletes a day's star counts
 *   24 UTC calendar months after the day they count.
 * - `ai_property_issue_groups.expired` deletes an expired group only after the
 *   analysis rule has removed every contribution mention that references it;
 *   members and merged redirects cascade with their group.
 *
 * A v2 analysis is not reached by the first rule. It stays under
 * `ai.local_derivatives`, unexecuted, until activation retires its generation.
 */

import {
  defineRetentionRegistryRule as rule,
  RESTORE_REPLAYS_DELETION,
  type RetentionRegistryRule,
} from './retention-registry-model'

const V3_ANALYSIS_PREDICATE = "analysis_profile_version = 'review-analysis-v3'"

const CASCADE_RESTORE_IMPLICATION =
  'A restore reinstates the row together with the analysis it belongs to; the post-restore retention sweep deletes both again and its evidence must be linked to the restore before the cell is reopened.'

export const AI_REVIEW_ANALYSIS_V3_RULES: ReadonlyArray<RetentionRegistryRule> =
  Object.freeze([
    rule({
      id: 'ai.review_analysis_v3_derivatives',
      dataClass: 'ai_derivatives',
      ownerContext: 'ai',
      ownerRole: 'AI context owner with the authorizing AccountAdmin',
      sourceKind: 'table',
      source: 'ai_review_analyses',
      eligibility: {
        anchorColumn: 'expires_at',
        horizon: { kind: 'months', months: 24 },
        predicate: V3_ANALYSIS_PREDICATE,
        query: `SELECT review_id FROM ai_review_analyses WHERE expires_at < now() AND ${V3_ANALYSIS_PREDICATE}. expires_at is stamped when the analysis is generated (completion plus 730 days) and is never recomputed: not by a read, a manager correction, an aggregate or a re-analysis, which each write other rows. The mention rows, their sentence numbers, the aggregate contribution and its mention rows cascade from the deleted row.`,
        implementedBoundary:
          'Live as the scheduled subject ai_review_analyses.v3_expired. Nothing selects a v3 analysis yet, so it deletes nothing until activation; the rule and its cascade are tested against PostgreSQL (ai-review-analysis-v3-retention.integration.test.ts). A v2 analysis is not reached: see ai.local_derivatives.',
      },
      evidenceSubject: 'ai_review_analyses.v3_expired',
      restoreImplication: RESTORE_REPLAYS_DELETION,
    }),
    rule({
      id: 'ai.review_analysis_v3_mentions',
      dataClass: 'ai_derivatives',
      ownerContext: 'ai',
      ownerRole: 'AI context owner with the authorizing AccountAdmin',
      sourceKind: 'table',
      source: 'ai_review_analysis_mentions',
      eligibility: {
        anchorColumn: null,
        horizon: { kind: 'months', months: 24 },
        predicate: 'the analysis the mention belongs to has been deleted',
        query:
          'No query of its own. A mention is deleted with its analysis through the analysis foreign key (ON DELETE CASCADE), 24 months after the analysis was generated. It holds a topic, a polarity, a strength, an optional generic cause and a names flag, and no quote, sentence, name or provider response.',
        implementedBoundary:
          'Live through the scheduled ai_review_analyses.v3_expired subject, by cascade.',
      },
      evidenceSubject: 'ai_review_analyses.v3_expired',
      restoreImplication: CASCADE_RESTORE_IMPLICATION,
    }),
    rule({
      id: 'ai.review_analysis_v3_mention_sentences',
      dataClass: 'ai_derivatives',
      ownerContext: 'ai',
      ownerRole: 'AI context owner with the authorizing AccountAdmin',
      sourceKind: 'table',
      source: 'ai_review_analysis_mention_sentences',
      eligibility: {
        anchorColumn: null,
        horizon: { kind: 'months', months: 24 },
        predicate: 'the mention the sentence number belongs to has been deleted',
        query:
          'No query of its own. A sentence number is deleted with its mention through the mention foreign key (ON DELETE CASCADE), so with its analysis 24 months after the analysis was generated. It is a bare integer; the sentence it points at is resolved live against the original review text and never stored.',
        implementedBoundary:
          'Live through the scheduled ai_review_analyses.v3_expired subject, by cascade.',
      },
      evidenceSubject: 'ai_review_analyses.v3_expired',
      restoreImplication: CASCADE_RESTORE_IMPLICATION,
    }),
    rule({
      id: 'ai.review_analysis_v3_contribution_mentions',
      dataClass: 'ai_derivatives',
      ownerContext: 'ai',
      ownerRole: 'AI context owner with the authorizing AccountAdmin',
      sourceKind: 'table',
      source: 'ai_property_aggregate_contribution_mentions',
      eligibility: {
        anchorColumn: null,
        horizon: { kind: 'months', months: 24 },
        predicate: 'the aggregate contribution the mention belongs to has been deleted',
        query:
          "No query of its own. A contribution mention is deleted with its aggregate contribution through the contribution foreign key (ON DELETE CASCADE), and that contribution goes with its analysis, so 24 months after the analysis was generated. It repeats the analysis's mention fields and nothing else.",
        implementedBoundary:
          'Live through the scheduled ai_review_analyses.v3_expired subject, by cascade.',
      },
      evidenceSubject: 'ai_review_analyses.v3_expired',
      restoreImplication: CASCADE_RESTORE_IMPLICATION,
    }),
    rule({
      id: 'ai.property_issue_groups',
      dataClass: 'ai_derivatives',
      ownerContext: 'ai',
      ownerRole: 'AI context owner with the authorizing AccountAdmin',
      sourceKind: 'table',
      source: 'ai_property_issue_groups',
      eligibility: {
        anchorColumn: 'expires_at',
        horizon: { kind: 'months', months: 24 },
        predicate:
          'expires_at has passed and no aggregate contribution mention references the group',
        query:
          'SELECT id FROM ai_property_issue_groups WHERE expires_at < now() AND NOT EXISTS (SELECT 1 FROM ai_property_aggregate_contribution_mentions m WHERE m.issue_group_id = ai_property_issue_groups.id). The deadline only moves forward when a mention is assigned; rename, hide and merge do not extend presentation metadata.',
        implementedBoundary:
          'Live as the scheduled subject ai_property_issue_groups.expired, ordered after ai_review_analyses.v3_expired so one run can first remove contribution references. Members and merged redirects cascade from the deleted group.',
      },
      evidenceSubject: 'ai_property_issue_groups.expired',
      restoreImplication: RESTORE_REPLAYS_DELETION,
    }),
    rule({
      id: 'ai.property_issue_members',
      dataClass: 'ai_derivatives',
      ownerContext: 'ai',
      ownerRole: 'AI context owner with the authorizing AccountAdmin',
      sourceKind: 'table',
      source: 'ai_property_issue_members',
      eligibility: {
        anchorColumn: null,
        horizon: { kind: 'months', months: 24 },
        predicate: 'the issue group the member belongs to has been deleted',
        query:
          'No query of its own. A member is deleted through its group foreign key (ON DELETE CASCADE) when the group deadline has passed and no contribution mention references that group.',
        implementedBoundary:
          'Live through the scheduled ai_property_issue_groups.expired subject, by cascade.',
      },
      evidenceSubject: 'ai_property_issue_groups.expired',
      restoreImplication: CASCADE_RESTORE_IMPLICATION,
    }),
    rule({
      id: 'ai.property_review_population_daily',
      dataClass: 'ai_derivatives',
      ownerContext: 'ai',
      ownerRole: 'AI context owner with the Review context owner',
      sourceKind: 'table',
      source: 'ai_property_review_population_daily',
      eligibility: {
        anchorColumn: 'local_date',
        horizon: { kind: 'months', months: 24 },
        predicate: null,
        query:
          'SELECT local_date FROM ai_property_review_population_daily WHERE local_date is more than 24 UTC calendar months before the run. The anchor is the day the counts are for, never updated_at: a late review re-counts its day and must not keep it. A row is a count of reviews by stars for one Property day, with no review identity, quote or name.',
        implementedBoundary:
          'Live as the scheduled subject ai_property_review_population_daily.expired, counted back from the run like the Guest visit facts (retention-cutoff.ts). Nothing writes the table yet.',
      },
      evidenceSubject: 'ai_property_review_population_daily.expired',
      restoreImplication: RESTORE_REPLAYS_DELETION,
    }),
  ])

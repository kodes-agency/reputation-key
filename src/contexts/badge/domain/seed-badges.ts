import type { BadgeSeedDefinitionInput } from './types'

/**
 * Positive portal-group badges may reference only the three governed,
 * first-party Portal operation metrics. Guest responses, reviews, ratings,
 * scans, clicks, named mentions, Google and AI sources are intentionally absent.
 */
export const SYSTEM_BADGE_DEFINITIONS: readonly BadgeSeedDefinitionInput[] = [
  {
    key: 'content_review_stewardship',
    name: 'Content Review Stewardship',
    description: 'Recognizes a portal group that completes governed content reviews.',
    icon: 'clipboard-check',
    targetScope: 'portal_group',
    criteria: {
      type: 'threshold',
      metricKey: 'portal.content_review.completed',
      operator: '>=',
      threshold: 5,
      aggregation: 'sum',
      period: 'this_month',
    },
  },
  {
    key: 'configuration_ready',
    name: 'Configuration Ready',
    description: 'Recognizes complete, published portal-group configuration.',
    icon: 'badge-check',
    targetScope: 'portal_group',
    criteria: {
      type: 'threshold',
      metricKey: 'portal.configuration_completeness',
      operator: '>=',
      threshold: 90,
      aggregation: 'max',
      period: 'this_month',
    },
  },
  {
    key: 'approved_destination_quality',
    name: 'Approved Destination Quality',
    description: 'Recognizes portal groups with a strong approved-destination ratio.',
    icon: 'route',
    targetScope: 'portal_group',
    criteria: {
      type: 'threshold',
      metricKey: 'portal.approved_destination_ratio',
      operator: '>=',
      threshold: 0.8,
      aggregation: 'avg',
      period: 'this_month',
    },
  },
] as const

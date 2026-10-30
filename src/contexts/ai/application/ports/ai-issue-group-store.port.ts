import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'

export type PropertyIssueScope = Readonly<{
  organizationId: string
  propertyId: string
}>

export type PropertyIssueGroup = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  topic: ReviewTopicV3
  canonicalThing: string | null
  canonicalKey: string
  displayName: string | null
  mergedIntoIssueId: string | null
  hiddenAt: Date | null
  hiddenBy: string | null
  createdAt: Date
  updatedAt: Date
  lastSeenAt: Date
  expiresAt: Date
  normalizationVersion: string
}>

export type PropertyIssueMutationResult =
  | Readonly<{ status: 'applied'; issue: PropertyIssueGroup }>
  | Readonly<{ status: 'not_found' }>

export type PropertyIssueVisibilityResult =
  | Readonly<{
      status: 'applied'
      changed: boolean
      issue: PropertyIssueGroup
    }>
  | Readonly<{ status: 'not_found' }>

export type PropertyIssueMergeResult =
  | Readonly<{ status: 'applied'; issue: PropertyIssueGroup; sourceIssueId: string }>
  | Readonly<{ status: 'same_issue' }>
  | Readonly<{ status: 'cross_topic' }>
  | Readonly<{ status: 'not_found' }>

export type PropertyIssueResolveResult =
  | Readonly<{
      status: 'found'
      issue: PropertyIssueGroup
      redirectedFromIssueId: string | null
    }>
  | Readonly<{ status: 'not_found' }>

export type AiIssueGroupStorePort = Readonly<{
  rename(
    scope: PropertyIssueScope,
    issueId: string,
    displayName: string | null,
    updatedAt: Date,
  ): Promise<PropertyIssueMutationResult>
  setHidden(
    scope: PropertyIssueScope,
    issueId: string,
    hidden: Readonly<{ at: Date; by: string }> | null,
    updatedAt: Date,
  ): Promise<PropertyIssueVisibilityResult>
  merge(
    scope: PropertyIssueScope,
    sourceIssueId: string,
    targetIssueId: string,
    updatedAt: Date,
  ): Promise<PropertyIssueMergeResult>
  resolve(scope: PropertyIssueScope, issueId: string): Promise<PropertyIssueResolveResult>
}>

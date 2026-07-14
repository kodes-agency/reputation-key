// Named retry/timeout/concurrency policies for the job runtime (PRE17A A2).
//
// Policies are referenced by name in JobDefinition. This centralizes
// retry behavior so changes don't require touching every job definition.

import type { JobsOptions } from 'bullmq'
import type { RetryPolicyName } from './contracts'

type Policy = Readonly<{
  /** BullMQ job options for this policy. */
  readonly jobOptions: Readonly<JobsOptions>
  /** Human-readable description for documentation. */
  readonly description: string
}>

const POLICIES: Readonly<Record<RetryPolicyName, Policy>> = {
  fast: {
    description: '3 attempts, 1s exponential backoff — transient blips',
    jobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
  standard: {
    description: '3 attempts, 30s exponential backoff — DB/Redis instability',
    jobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
  patient: {
    description: '5 attempts, 60s exponential backoff — external API rate limits',
    jobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
  'no-retry': {
    description: '1 attempt — fire-and-forget or externally idempotent',
    jobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
} as const

/** Get BullMQ job options for a named retry policy. */
export function getPolicyJobOptions(name: RetryPolicyName): Readonly<JobsOptions> {
  return POLICIES[name].jobOptions
}

/** Get the human-readable description for a named retry policy. */
export function getPolicyDescription(name: RetryPolicyName): string {
  return POLICIES[name].description
}

/** List all policy names (for validation or UI). */
export function getPolicyNames(): readonly RetryPolicyName[] {
  return Object.keys(POLICIES) as RetryPolicyName[]
}

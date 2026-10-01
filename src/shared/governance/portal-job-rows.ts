// The Portal job families of the event/job catalogue, in their own module so the
// catalogue (a grandfathered file that may not grow) does not carry them.
//
// Plain rows rather than the catalogue's `job()` factory: the factory lives in the
// catalogue, which imports this module, and the retry defaults it bakes in are
// written out here instead. Only the row type is shared, and that import is
// erased at build time.

import type { JobFamilyRow } from './event-job-catalogue'

export const PORTAL_BACKGROUND_JOB_ROWS: ReadonlyArray<JobFamilyRow> = [
  {
    jobName: 'portal-approved-destination-revalidation',
    queue: 'background',
    processor:
      'src/contexts/portal/infrastructure/jobs/revalidate-approved-destinations.job.ts',
    retryAttempts: 3,
    retryBackoff: 'exponential:30000',
    timeoutMs: 300_000,
    schedule: 'every:900000',
    capability: 'portal.write',
    action: 'system:portal.destination_revalidate',
    registration: 'enabled',
  },
  // Not capability-gated: cleaning the object store must run whatever the state of
  // the upload capability, because it is what makes switching uploads off safe.
  {
    jobName: 'portal-media-sweep',
    queue: 'background',
    processor: 'src/contexts/portal/infrastructure/jobs/sweep-portal-media.job.ts',
    retryAttempts: 3,
    retryBackoff: 'exponential:30000',
    timeoutMs: 300_000,
    schedule: 'every:3600000,offset:1800000',
    capability: 'none',
    action: 'system:portal.media_sweep',
    registration: 'enabled',
  },
]

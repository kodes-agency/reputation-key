// The Portal job families of the event/job catalogue, selected from the derived
// rows.

import { JOB_FAMILY_ROWS, type JobFamilyRow } from './event-job-catalogue'

const PORTAL_JOB_NAMES: ReadonlySet<string> = new Set([
  'portal-approved-destination-revalidation',
  'portal-media-sweep',
])

export const PORTAL_BACKGROUND_JOB_ROWS: ReadonlyArray<JobFamilyRow> =
  JOB_FAMILY_ROWS.filter((row) => PORTAL_JOB_NAMES.has(row.jobName))

// Import progress card — renders counts (imported / skipped / failed), a status
// badge, and a "Go to Properties" CTA once the job reaches a final state.
// `useNavigate`/`useRouter` are supplied globally by the Storybook memory router.
import type { Meta, StoryObj } from '@storybook/react'
import type {
  GbpImportJob,
  GbpImportJobStatus,
} from '#/contexts/integration/application/public-api'
import { gbpImportJobId, organizationId, userId } from '#/shared/domain/ids'
import { ImportProgress } from './import-progress'

const meta: Meta<typeof ImportProgress> = {
  title: 'Integration/ImportProgress',
  component: ImportProgress,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof ImportProgress>

function makeJob(
  overrides: Partial<GbpImportJob> & { status: GbpImportJobStatus },
): GbpImportJob {
  return {
    id: gbpImportJobId('job-1'),
    organizationId: organizationId('org-1'),
    initiatedBy: userId('user-1'),
    totalCount: 12,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:05:00Z'),
    ...overrides,
  }
}

// Just queued — nothing imported yet, no CTA (not final).
export const Queued: Story = {
  args: { job: makeJob({ status: 'queued' }) },
}

// Mid-flight — counts partial, still no CTA.
export const InProgress: Story = {
  args: {
    job: makeJob({
      status: 'in_progress',
      importedCount: 5,
      skippedCount: 1,
    }),
  },
}

// Clean finish — final CTA shows.
export const Completed: Story = {
  args: {
    job: makeJob({
      status: 'completed',
      importedCount: 12,
    }),
  },
}

// Finished with skips — summary line notes "some failures".
export const CompletedWithSkips: Story = {
  args: {
    job: makeJob({
      status: 'completed_with_skips',
      importedCount: 10,
      skippedCount: 2,
    }),
  },
}

// Finished with failures — destructive badge + summary.
export const CompletedWithFailures: Story = {
  args: {
    job: makeJob({
      status: 'completed_with_failures',
      importedCount: 9,
      failedCount: 3,
    }),
  },
}

// Whole job failed — destructive badge, nothing imported, CTA shows.
export const Failed: Story = {
  args: {
    job: makeJob({ status: 'failed', failedCount: 12 }),
  },
}

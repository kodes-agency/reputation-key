import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { getRecognitionBoard } from '#/contexts/leaderboard/server/leaderboards'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

const recognitionSearch = z.object({
  propertyId: z.string().uuid().optional(),
  portalGroupId: z.string().uuid().optional(),
})

const boardWatermarkFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export const Route = createFileRoute('/_authenticated/leaderboard')({
  validateSearch: recognitionSearch,
  beforeLoad: async ({ search }) => {
    if (!search.propertyId) return
    await gateControlledRoute({
      data: {
        capability: 'leaderboard.use',
        featureLabel: 'Recognition board',
        propertyId: search.propertyId,
      },
    })
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => ({
    board: deps.propertyId
      ? await getRecognitionBoard({
          data: {
            propertyId: deps.propertyId,
            portalGroupId: deps.portalGroupId,
          },
        })
      : null,
  }),
  component: RecognitionBoardPage,
})

function RecognitionBoardPage() {
  const { propertyId } = Route.useSearch()
  const { board } = Route.useLoaderData()

  if (!propertyId) {
    return (
      <PageShell>
        <PageHeader
          title="Recognition board"
          description="Select a property to view positive portal-group recognition."
        />
        <StaffEmptyState />
      </PageShell>
    )
  }

  if (!board || board.entries.length === 0) {
    return (
      <PageShell>
        <PageHeader
          title="Recognition board"
          description="Positive, property-local recognition for authorized portal groups."
        />
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Recognition is inactive, still reconciling, or has no authorized group data.
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader
        title="Recognition board"
        description="Coaching and celebration only. This information is never eligible for employment decisions."
      />

      <section
        aria-labelledby="recognition-status"
        className="rounded-lg border bg-card p-4"
      >
        <h2 id="recognition-status" className="font-medium">
          {board.periodKind} board
        </h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{board.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fresh through</dt>
            <dd>{boardWatermarkFormatter.format(new Date(board.sourceWatermark))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Corrections</dt>
            <dd>{board.correctionGeneration}</dd>
          </div>
        </dl>
      </section>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Portal-group recognition ranks, including ties and data eligibility
          </caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3" scope="col">
                Rank
              </th>
              <th className="px-4 py-3" scope="col">
                Portal group
              </th>
              <th className="px-4 py-3" scope="col">
                Result
              </th>
              <th className="px-4 py-3" scope="col">
                Sample
              </th>
              <th className="px-4 py-3" scope="col">
                Data state
              </th>
            </tr>
          </thead>
          <tbody>
            {board.entries.map((entry) => (
              <tr key={entry.portalGroupId} className="border-t">
                <td className="px-4 py-3">
                  {entry.rank === null ? '—' : entry.rank}
                  {entry.tieGroup !== null ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      tie group {entry.tieGroup}
                    </span>
                  ) : null}
                </td>
                <th className="px-4 py-3 text-left font-medium" scope="row">
                  {entry.portalGroupLabel}
                </th>
                <td className="px-4 py-3">
                  {entry.value === null ? 'Insufficient data' : entry.value}
                </td>
                <td className="px-4 py-3">
                  {entry.sampleCount} samples / {entry.exposureCount} exposures
                </td>
                <td className="px-4 py-3">
                  {entry.status === 'corrected'
                    ? `Corrected (${entry.correctionGeneration})`
                    : entry.eligibilityReason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}

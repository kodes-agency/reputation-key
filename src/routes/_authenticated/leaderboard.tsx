import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import {
  getLeaderboard,
  getComparisonMatrix,
} from '#/contexts/leaderboard/server/leaderboards'
import { leaderboardKeys } from '#/shared/queries/query-keys'
import { StaffEmptyState } from '#/components/features/staff/staff-empty-state'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { gateDarkRoute } from '#/shared/auth/dark-route-gate'
import type {
  LeaderboardEntryWithTarget,
  MatrixRow,
  MatrixCell,
} from '#/contexts/leaderboard/application/public-api'

const METRICS = [
  'portal.rating',
  'portal.feedback',
  'portal.scan',
  'portal.review_link_click',
] as const

const leaderboardSearch = z.object({
  propertyId: z.string().uuid().optional(),
  period: z
    .enum([
      'today',
      'this_week',
      'this_month',
      'this_quarter',
      'all_time',
      'last_7_days',
      'last_30_days',
      'last_90_days',
    ])
    .default('this_month'),
  scope: z.enum(['portal', 'portal_group']).default('portal'),
  metricKey: z
    .enum(['portal.rating', 'portal.feedback', 'portal.scan', 'portal.review_link_click'])
    .default('portal.rating'),
  view: z.enum(['matrix', 'leaderboard']).default('matrix'),
})

type Period = z.infer<typeof leaderboardSearch>['period']
type Scope = z.infer<typeof leaderboardSearch>['scope']
type MetricKey = z.infer<typeof leaderboardSearch>['metricKey']
type View = z.infer<typeof leaderboardSearch>['view']

const PERIOD_LABELS: Readonly<Record<Period, string>> = {
  today: 'Today',
  this_week: 'This Week',
  this_month: 'This Month',
  this_quarter: 'This Quarter',
  all_time: 'All Time',
  last_7_days: 'Last 7 Days',
  last_30_days: 'Last 30 Days',
  last_90_days: 'Last 90 Days',
}

const METRIC_LABELS: Readonly<Record<MetricKey, string>> = {
  'portal.rating': 'Avg Rating',
  'portal.feedback': 'Feedback',
  'portal.scan': 'Scans',
  'portal.review_link_click': 'Link Clicks',
}

const comparisonMatrixQuery = (propertyId: string, period: Period, scope: Scope) =>
  queryOptions({
    queryKey: leaderboardKeys.matrix({ propertyId, period, scope }),
    queryFn: () => getComparisonMatrix({ data: { propertyId, period, scope } }),
    staleTime: 60 * 1000,
  })

const leaderboardQuery = (
  propertyId: string,
  period: Period,
  scope: Scope,
  metricKey: MetricKey,
) =>
  queryOptions({
    queryKey: leaderboardKeys.board({ propertyId, period, scope, metricKey }),
    queryFn: () => getLeaderboard({ data: { propertyId, period, scope, metricKey } }),
    staleTime: 60 * 1000,
  })

export const Route = createFileRoute('/_authenticated/leaderboard')({
  beforeLoad: async () => {
    await gateDarkRoute({
      data: { capability: 'leaderboard.use', featureLabel: 'Leaderboard' },
    })
  },
  validateSearch: leaderboardSearch,
  loaderDeps: ({ search }) => ({
    propertyId: search.propertyId,
    period: search.period,
    scope: search.scope,
    metricKey: search.metricKey,
    view: search.view,
  }),
  loader: async ({ context, deps: { propertyId, period, scope, metricKey, view } }) => {
    if (!propertyId) {
      return { view, matrix: null, entries: null }
    }
    if (view === 'matrix') {
      const matrix = await context.queryClient.ensureQueryData(
        comparisonMatrixQuery(propertyId, period, scope),
      )
      return { view, matrix: matrix as MatrixRow[], entries: null }
    }
    const entries = await context.queryClient.ensureQueryData(
      leaderboardQuery(propertyId, period, scope, metricKey),
    )
    return {
      view,
      matrix: null,
      entries: entries as LeaderboardEntryWithTarget[],
    }
  },
  component: StaffLeaderboardPage,
})

// fallow-ignore-next-line complexity — pre-existing component on main (BQC-2.6 touched only this file's beforeLoad gate, not the component)
function StaffLeaderboardPage() {
  const {
    propertyId: searchPropertyId,
    period,
    scope,
    metricKey,
    view,
  } = Route.useSearch()

  const { data: matrixData } = useSuspenseQuery({
    ...comparisonMatrixQuery(searchPropertyId ?? '', period, scope),
  })
  const { data: entriesData } = useSuspenseQuery({
    ...leaderboardQuery(searchPropertyId ?? '', period, scope, metricKey),
  })

  const matrix = (matrixData ?? null) as MatrixRow[] | null
  const entries = (entriesData ?? null) as LeaderboardEntryWithTarget[] | null
  const navigate = useNavigate()
  const updateSearch = (
    patch: Partial<{ period: Period; scope: Scope; metricKey: MetricKey; view: View }>,
  ) => {
    navigate({
      to: '/leaderboard',
      search: {
        propertyId: searchPropertyId,
        period,
        scope,
        metricKey,
        view,
        ...patch,
      },
      replace: true,
    })
  }

  if (!searchPropertyId) {
    return (
      <PageShell>
        <PageHeader
          title="Leaderboard"
          description="See how your portals and groups compare."
        />
        <StaffEmptyState />
      </PageShell>
    )
  }

  const periods: Period[] = [
    'today',
    'this_week',
    'this_month',
    'this_quarter',
    'last_7_days',
    'last_30_days',
    'last_90_days',
    'all_time',
  ]

  return (
    <PageShell>
      <PageHeader
        title="Leaderboard"
        description="Portal performance across activity and quality. Compare side-by-side or rank by one metric."
      />

      {/* View toggle */}
      <div className="flex gap-2">
        {(['matrix', 'leaderboard'] as const).map((v) => (
          <button
            key={v}
            onClick={() => updateSearch({ view: v })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === v
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {v === 'matrix' ? 'Comparison' : 'Ranking'}
          </button>
        ))}
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {periods.map((p) => (
          <button
            key={p}
            onClick={() => updateSearch({ period: p })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              period === p
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Scope toggle */}
      <div className="flex gap-2">
        {(['portal', 'portal_group'] as const).map((s) => (
          <button
            key={s}
            onClick={() => updateSearch({ scope: s })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {s === 'portal' ? 'Portals' : 'Portal Groups'}
          </button>
        ))}
      </div>

      {view === 'leaderboard' && (
        <>
          {/* Metric tabs */}
          <div className="flex flex-wrap gap-2">
            {METRICS.map((m) => (
              <button
                key={m}
                onClick={() => updateSearch({ metricKey: m })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  metricKey === m
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>

          {entries && entries.length === 0 ? (
            <EmptyData />
          ) : (
            entries && <RankingTable entries={entries} metricKey={metricKey} />
          )}
        </>
      )}

      {view === 'matrix' &&
        (matrix && matrix.length === 0 ? (
          <EmptyData />
        ) : (
          matrix && <MatrixTable rows={matrix} />
        ))}
    </PageShell>
  )
}

function EmptyData() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      No leaderboard data for this period yet. Data refreshes hourly.
    </div>
  )
}

const MEDALS: readonly string[] = ['🥇', '🥈', '🥉']

function RankingRow({
  entry,
  idx,
}: Readonly<{ entry: LeaderboardEntryWithTarget; idx: number }>) {
  return (
    <tr className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
      <td className="px-4 py-2 font-medium">
        {entry.rank <= MEDALS.length ? MEDALS[entry.rank - 1] : entry.rank}
      </td>
      <td className="px-4 py-2">{entry.targetName}</td>
      <td className="px-4 py-2 text-right">{(entry.score * 100).toFixed(1)}</td>
      <td className="px-4 py-2 text-right text-muted-foreground">
        {entry.metricValue.toFixed(1)}
      </td>
    </tr>
  )
}

function RankingTableHead({ metricKey }: Readonly<{ metricKey: MetricKey }>) {
  return (
    <thead className="bg-muted/50">
      <tr>
        <th className="px-4 py-2 text-left font-medium">Rank</th>
        <th className="px-4 py-2 text-left font-medium">Name</th>
        <th className="px-4 py-2 text-right font-medium">Score</th>
        <th className="px-4 py-2 text-right font-medium">{METRIC_LABELS[metricKey]}</th>
      </tr>
    </thead>
  )
}

function RankingTable({
  entries,
  metricKey,
}: Readonly<{ entries: LeaderboardEntryWithTarget[]; metricKey: MetricKey }>) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <RankingTableHead metricKey={metricKey} />
        <tbody>
          {entries.map((entry, idx) => (
            <RankingRow
              key={`${entry.targetType}:${entry.targetId}`}
              entry={entry}
              idx={idx}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Comparison matrix: portals × metrics, raw value + per-column rank, color-coded.
 *  Rows arrive pre-sorted worst-first by rating (insufficient/unranked last). */
function MatrixTable({ rows }: Readonly<{ rows: MatrixRow[] }>) {
  const maxRankFor = (key: MetricKey): number =>
    Math.max(1, ...rows.map((r) => r.cells.find((c) => c.metricKey === key)?.rank ?? 0))

  const cellStyle = (cell: MatrixCell | undefined, key: MetricKey) => {
    if (!cell || cell.rank === null) return undefined
    const top = maxRankFor(key)
    const score = top <= 1 ? 1 : 1 - (cell.rank - 1) / (top - 1) // 1 = best, 0 = worst
    return { backgroundColor: `hsl(${Math.round(score * 120)}, 60%, 92%)` }
  }

  const cellText = (cell: MatrixCell | undefined): string => {
    if (!cell || cell.insufficient || cell.rank === null) return '—'
    return cell.metricKey === 'portal.rating'
      ? cell.value.toFixed(1)
      : cell.value.toLocaleString()
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Name</th>
            {METRICS.map((m) => (
              <th key={m} className="px-4 py-2 text-right font-medium">
                {METRIC_LABELS[m]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.target.targetType}:${row.target.targetId}`}>
              <td className="px-4 py-2 font-medium">{row.target.targetName}</td>
              {METRICS.map((m) => {
                const cell = row.cells.find((c) => c.metricKey === m)
                const muted = !cell || cell.insufficient || cell.rank === null
                return (
                  <td key={m} className="px-4 py-2 text-right" style={cellStyle(cell, m)}>
                    <span className={muted ? 'text-muted-foreground' : ''}>
                      {cellText(cell)}
                    </span>
                    {cell && cell.rank !== null && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        #{cell.rank}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

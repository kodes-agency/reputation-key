/**
 * Production readers allowed to query `metric_readings` without going through
 * the Metric bounded context's public API.
 *
 * The companion architecture test discovers direct table reads and compares
 * their source files with this list, so every unreviewed reader fails closed.
 */
export const METRIC_READING_DIRECT_READ_AUTHORITIES = [
  {
    id: 'dashboard.legacy-kpi-projection',
    source: 'src/contexts/dashboard/infrastructure/read-facade.ts',
    symbol: 'readMetricAggregates',
  },
  {
    id: 'dashboard.fleet-overview-projection',
    source:
      'src/contexts/dashboard/infrastructure/adapters/fleet-overview-projection.adapter.ts',
    symbol: 'createFleetOverviewProjectionAdapter.read',
  },
] as const

import { useQuery } from '@tanstack/react-query'
import type { getPropertyAiTrendFn } from '#/contexts/ai/server/property-trend'
import { aiKeys } from '#/shared/queries/query-keys'
import {
  TrendPendingNotice,
  TrendQuietNotice,
  TrendReadyReport,
  TrendUnavailableNotice,
} from './property-ai-trend-states'

export type PropertyAiTrendServerFn = typeof getPropertyAiTrendFn

export function PropertyAiTrendSection({
  propertyId,
  getTrend,
}: Readonly<{
  propertyId: string
  getTrend: PropertyAiTrendServerFn
}>) {
  const trend = useQuery({
    queryKey: aiKeys.propertyTrend(propertyId),
    queryFn: () => getTrend({ data: { propertyId } }),
    staleTime: 60_000,
    retry: false,
  })

  if (trend.isPending || trend.data?.status === 'disabled') return null
  if (trend.isError) return <TrendUnavailableNotice />

  const read = trend.data
  if (!read) return null
  if (read.status === 'preparing' || read.status === 'updating') {
    return <TrendPendingNotice trend={read} />
  }
  if (read.status === 'insufficient_data' || read.status === 'no_material_change') {
    return <TrendQuietNotice trend={read} />
  }
  if (read.status !== 'ready') return null
  return <TrendReadyReport trend={read} />
}

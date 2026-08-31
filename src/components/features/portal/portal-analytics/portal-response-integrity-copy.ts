export type PortalResponseIntegritySummaryView = Readonly<{
  accepted: number
  filteredAutomatically: number
  underReview: number
  total: number
}>

export function portalResponseIntegrityCopy(
  summary: PortalResponseIntegritySummaryView,
): string {
  const outside = summary.filteredAutomatically + summary.underReview
  if (outside === 0) {
    return 'No Portal responses in this period are outside the private-rating figures.'
  }
  return `${outside.toLocaleString()} Portal ${outside === 1 ? 'response is' : 'responses are'} currently outside the private-rating figures while quality checks are resolved.`
}

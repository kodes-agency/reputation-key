import { useQuery } from '@tanstack/react-query'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { staffKeys } from '#/shared/queries/query-keys'
import type { StaffAccountFunctions } from './staff-account-functions'
export function StaffSourcePreview({
  propertyId,
  source,
  group,
  checkSource,
}: Readonly<{
  propertyId: string
  source: string
  group: string
  checkSource: StaffAccountFunctions['checkStaffSource']
}>) {
  const query = useQuery({
    queryKey: staffKeys.source(propertyId, source, group),
    queryFn: () =>
      checkSource({
        data: {
          propertyId,
          ...(source === 'property' ? {} : { sourcePortalId: source }),
          ...(group === 'none' ? {} : { portalGroupId: group }),
        },
      }),
  })
  return (
    <>
      <FormErrorBanner error={query.error} />
      {query.data?.omittedLinks.length ? (
        <p className="text-sm text-muted-foreground">
          The copy leaves out:{' '}
          {query.data.omittedLinks.map((link) => link.label).join(', ')}.
        </p>
      ) : null}
    </>
  )
}

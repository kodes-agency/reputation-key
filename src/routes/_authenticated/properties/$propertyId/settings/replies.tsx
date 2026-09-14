import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { PropertyReplyLanguageCard } from '#/components/features/settings/property-reply-language-card'
import { PropertyReplyProfileCard } from '#/components/features/property/property-reply-profile-card'
import { PropertyReplyTemplateLibraryCard } from '#/components/features/property/property-reply-template-library-card'
import { updateProperty } from '#/contexts/property/server/properties'
import {
  savePropertyReplyProfileFn,
  savePropertyReplyTemplateFn,
  setPropertyReplyTemplateEnabledFn,
} from '#/contexts/review/server/reply'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { can } from '#/shared/domain/permissions'
import { inboxKeys, propertyKeys, reviewKeys } from '#/shared/queries/query-keys'
import { propertyReplyLibraryQuery } from '../-settings-queries'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/replies',
)({
  loader: async ({ params: { propertyId }, context }) => {
    const { role } = context as AuthRouteContext
    if (can(role, 'reply.manage')) {
      await context.queryClient.ensureQueryData(propertyReplyLibraryQuery(propertyId))
    }
  },
  component: PropertyRepliesSettings,
})

function PropertyRepliesSettings() {
  const { propertyId } = Route.useParams()
  const { role } = Route.useRouteContext() as AuthRouteContext
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  const canManageReplies = can(role, 'reply.manage')
  const { data: library } = useQuery({
    ...propertyReplyLibraryQuery(propertyId),
    enabled: canManageReplies,
  })
  const updateReplyLanguage = useActionMutation(updateProperty, {
    successMessage: 'Property reply language updated',
    invalidateKeys: [
      propertyKeys.list(),
      propertyKeys.detail(propertyId),
      inboxKeys.details(),
    ],
  })
  const libraryKeys = [reviewKeys.replyLibrary(propertyId)]
  const saveProfile = useActionMutation(savePropertyReplyProfileFn, {
    successMessage: 'Reply profile saved',
    invalidateKeys: libraryKeys,
  })
  const saveTemplate = useActionMutation(savePropertyReplyTemplateFn, {
    successMessage: 'Reply template saved',
    invalidateKeys: libraryKeys,
  })
  const setTemplateEnabled = useActionMutation(setPropertyReplyTemplateEnabledFn, {
    successMessage: 'Reply template availability updated',
    invalidateKeys: libraryKeys,
  })

  return (
    <>
      {can(role, 'property.update') ? (
        <PropertyReplyLanguageCard
          key={`${propertyId}:${data.property.defaultReplyLanguage ?? 'unconfigured'}`}
          property={data.property}
          updateProperty={updateReplyLanguage}
        />
      ) : null}
      {canManageReplies ? (
        <>
          <PropertyReplyProfileCard
            key={`${propertyId}:${library?.profile?.version ?? 0}`}
            propertyId={propertyId}
            profile={library?.profile ?? null}
            action={saveProfile}
          />
          <PropertyReplyTemplateLibraryCard
            propertyId={propertyId}
            profile={library?.profile ?? null}
            templates={library?.templates ?? []}
            defaultLanguageTag={library?.defaultLanguageTag ?? null}
            saveAction={saveTemplate}
            toggleAction={setTemplateEnabled}
          />
        </>
      ) : null}
    </>
  )
}

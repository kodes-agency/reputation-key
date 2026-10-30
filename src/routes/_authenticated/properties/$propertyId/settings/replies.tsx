import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import { PropertyReplyLanguageCard } from '#/components/features/settings/property-reply-language-card'
import { ReplyVoiceCard } from '#/components/features/property/reply-voice-card'
import { ReplyTemplateLibraryCard } from '#/components/features/property/reply-template-library-card'
import { updateProperty } from '#/contexts/property/server/properties'
import { propertiesQuery, propertyQuery } from '#/routes/-queries/route-queries'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { inboxKeys, propertyKeys, reviewKeys } from '#/shared/queries/query-keys'
import { propertyReplyLibraryQuery } from './-reply-library-query'

type ReplyLibraryServer = typeof import('#/contexts/review/server/reply-library')

const saveReplyVoiceLazily = async (
  input: Parameters<ReplyLibraryServer['saveReplyVoiceFn']>[0],
): Promise<Awaited<ReturnType<ReplyLibraryServer['saveReplyVoiceFn']>>> =>
  (await import('#/contexts/review/server/reply-library')).saveReplyVoiceFn(input)

const saveReplyTemplateLazily = async (
  input: Parameters<ReplyLibraryServer['saveReplyTemplateFn']>[0],
): Promise<Awaited<ReturnType<ReplyLibraryServer['saveReplyTemplateFn']>>> =>
  (await import('#/contexts/review/server/reply-library')).saveReplyTemplateFn(input)

const setReplyTemplateHiddenLazily = async (
  input: Parameters<ReplyLibraryServer['setReplyTemplateHiddenFn']>[0],
): Promise<Awaited<ReturnType<ReplyLibraryServer['setReplyTemplateHiddenFn']>>> =>
  (await import('#/contexts/review/server/reply-library')).setReplyTemplateHiddenFn(input)

const resetReplyTemplateLazily = async (
  input: Parameters<ReplyLibraryServer['resetReplyTemplateFn']>[0],
): Promise<Awaited<ReturnType<ReplyLibraryServer['resetReplyTemplateFn']>>> =>
  (await import('#/contexts/review/server/reply-library')).resetReplyTemplateFn(input)

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/replies',
)({
  loader: ({ params: { propertyId }, context }) =>
    import('./-gate').then(({ default: load }) => load(context, propertyId)),
  component: PropertyRepliesSettings,
})

function PropertyRepliesSettings() {
  const { propertyId } = Route.useParams()
  const { can: canDo } = usePermissions()
  const { data } = useSuspenseQuery(propertyQuery(propertyId))
  const { data: properties } = useSuspenseQuery(propertiesQuery)
  const updateReplyLanguage = useActionMutation(updateProperty, {
    successMessage: 'Reply language saved',
    invalidateKeys: [
      propertyKeys.list(),
      propertyKeys.detail(propertyId),
      inboxKeys.details(),
    ],
  })
  const languageCard = canDo('property.update') ? (
    <PropertyReplyLanguageCard
      key={`${propertyId}:${data.property.defaultReplyLanguage ?? 'unconfigured'}`}
      property={data.property}
      updateProperty={updateReplyLanguage}
    />
  ) : null

  if (!canDo('reply.manage')) return languageCard

  return (
    <>
      {languageCard}
      <ReplyLibrarySettings
        propertyId={propertyId}
        propertyName={data.property.name}
        propertyCount={properties.properties.length}
        canManage={canDo('reply_library.manage')}
      />
    </>
  )
}

function ReplyLibrarySettings({
  propertyId,
  propertyName,
  propertyCount,
  canManage,
}: Readonly<{
  propertyId: string
  propertyName: string
  propertyCount: number
  canManage: boolean
}>) {
  const queryClient = useQueryClient()
  const { data: library } = useSuspenseQuery(propertyReplyLibraryQuery(propertyId))
  const libraryKeys = [
    reviewKeys.replyLibrary(propertyId),
    propertyKeys.setup(propertyId),
  ]
  const rereadLibrary = () =>
    void queryClient.invalidateQueries({ queryKey: reviewKeys.replyLibrary(propertyId) })
  const saveVoice = useActionMutation(saveReplyVoiceLazily, {
    successMessage: 'Reply voice saved',
    invalidateKeys: libraryKeys,
    onError: rereadLibrary,
  })
  const saveTemplate = useActionMutation(saveReplyTemplateLazily, {
    successMessage: 'Reply template saved',
    invalidateKeys: libraryKeys,
    onError: rereadLibrary,
  })
  const setTemplateHidden = useActionMutation(setReplyTemplateHiddenLazily, {
    successMessage: 'Reply template visibility updated',
    errorMessage: actionErrorMessage,
    invalidateKeys: libraryKeys,
    onError: rereadLibrary,
  })
  const resetTemplate = useActionMutation(resetReplyTemplateLazily, {
    successMessage: 'Reply template reset',
    invalidateKeys: libraryKeys,
    onError: rereadLibrary,
  })

  return (
    <>
      <ReplyVoiceCard
        key={`${propertyId}:${library.voiceVersion.account}:${library.voiceVersion.property}`}
        propertyId={propertyId}
        propertyName={propertyName}
        propertyCount={propertyCount}
        library={{
          ...library,
          canManage: library.canManage === true && canManage,
        }}
        action={saveVoice}
      />
      <ReplyTemplateLibraryCard
        propertyId={propertyId}
        propertyName={propertyName}
        propertyCount={propertyCount}
        library={{
          ...library,
          canManage: library.canManage === true && canManage,
        }}
        saveAction={saveTemplate}
        hideAction={setTemplateHidden}
        resetAction={resetTemplate}
      />
    </>
  )
}

import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '#/components/layout/page-header'
import { trailCrumbs } from '#/components/layout/page-identity'
import { useServerFn } from '@tanstack/react-start'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import {
  updateProfileFn,
  updateUserImageFn,
} from '#/contexts/identity/server/auth-settings'
import {
  requestAvatarUpload,
  finalizeAvatarUpload,
} from '#/contexts/identity/server/organizations'
import { updateNotificationUserSettingsFn } from '#/contexts/feed/server/notifications'
import { ProfileSettingsPage } from '#/components/features/identity'
import { TimezoneAndFormatCard } from '#/components/features/settings'
import { notificationUserSettingsQuery } from '#/routes/-queries/route-queries'
import { identityKeys, notificationKeys } from '#/shared/queries/query-keys'
import type { AuthRouteContext } from '#/routes/_authenticated'

const NO_ACTIVE_ORGANIZATION = 'no-active-organization'

export const Route = createFileRoute('/_authenticated/settings/profile')({
  staticData: { page: { title: 'Profile', under: 'settings' } },
  loader: async ({ context }) => {
    const organizationId =
      (context as AuthRouteContext).activeOrganization?.id ?? NO_ACTIVE_ORGANIZATION
    // Awaited, so the server renders the card the client hydrates: rendering
    // it on one side and its loading state on the other is a hydration
    // mismatch, and React then re-renders the page under the reader's first
    // click. `prefetchQuery` never throws, so a failed read shows in the card,
    // with Try again, and never takes the name and avatar down with it.
    // No retry here: a failing read would hold the whole page for it.
    await context.queryClient.prefetchQuery({
      ...notificationUserSettingsQuery(organizationId),
      retry: false,
    })
  },
  component: ProfileSettings,
})

function ProfileSettings() {
  const ctx = Route.useRouteContext() as AuthRouteContext
  const router = useRouter()
  const organizationId = ctx.activeOrganization?.id ?? NO_ACTIVE_ORGANIZATION
  // The name and avatar are not a Query: the form's saved values and the top bar's
  // account menu are the `user` that `_authenticated`'s `beforeLoad` puts in the route
  // context. A save therefore has that route read the session again. Only it is marked
  // stale, so every other page keeps the data it loaded.
  const readSignedInUserAgain = () =>
    router.invalidate({ filter: (match) => match.routeId === '/_authenticated' })
  const updateProfile = useActionMutation(updateProfileFn, {
    successMessage: 'Profile saved',
    // Two Query caches hold the name as well: the member list, which Members, Inbox,
    // Portals and Goals name a member from, and the invitations' "Invited by". Neither
    // is on screen here, so this asks the server for nothing: the next page to show them
    // reads again, where it would have drawn the old name for the rest of its 30 seconds.
    invalidateKeys: [identityKeys.members(), identityKeys.organizationInvitations()],
    // Awaited: the save resolves with the saved name already the form's baseline, so
    // the form never shows saved edits as unsaved (dirty, with a Reset to the old name).
    onSuccess: readSignedInUserAgain,
  })
  // Both are immediate actions: the avatar setting says a refusal, so neither passes an
  // `errorMessage`. Neither waits for the read: the setting draws its own outcome the
  // moment the save lands and hands the focus on when Remove leaves with the picture,
  // and the top bar follows.
  const updateUserImage = useActionMutation(updateUserImageFn, {
    successMessage: 'Avatar updated',
    onSuccess: () => void readSignedInUserAgain(),
  })
  const removeUserImage = useActionMutation(updateUserImageFn, {
    successMessage: 'Avatar removed',
    onSuccess: () => void readSignedInUserAgain(),
  })
  const requestUpload = useServerFn(requestAvatarUpload)
  const finalizeUpload = useServerFn(finalizeAvatarUpload)
  // Timezone and date format are the person's clock (D6): quiet hours, the
  // daily digest and every notification time go by them. They are kept per
  // Organization membership, so only an active Organization has them.
  const userSettings = useQuery(notificationUserSettingsQuery(organizationId))
  const updateUserSettings = useActionMutation(updateNotificationUserSettingsFn, {
    invalidateKeys: [notificationKeys.userSettings(organizationId)],
  })

  return (
    <>
      <PageHeader
        title="Profile"
        description="Manage your name, email, avatar, timezone and date format."
        breadcrumbs={trailCrumbs('settings', {}, 'Profile')}
      />
      <div className="mt-6 space-y-6">
        <ProfileSettingsPage
          user={ctx.user}
          updateProfile={updateProfile}
          updateUserImage={updateUserImage}
          removeUserImage={removeUserImage}
          requestAvatarUpload={requestUpload}
          finalizeAvatarUpload={finalizeUpload}
        />
        {/* The server answers null without an Organization context. */}
        {ctx.activeOrganization && userSettings.data !== null ? (
          <TimezoneAndFormatCard
            settings={userSettings.data}
            failed={userSettings.errorUpdateCount > 0 && userSettings.data === undefined}
            retrying={userSettings.isFetching}
            onRetry={() => void userSettings.refetch()}
            organizationName={ctx.activeOrganization.name}
            updateUserSettings={updateUserSettings}
          />
        ) : null}
      </div>
    </>
  )
}

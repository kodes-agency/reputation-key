// Profile settings page — wrapper component that renders the profile settings form
// Per conventions: receives user data and serverFns from route context and renders the form.
import { ProfileSettingsForm, type Props as FormProps } from './profile-settings-form'

export type Props = Readonly<{
  user: FormProps['user']
  requestAvatarUpload: FormProps['requestAvatarUpload']
  finalizeAvatarUpload: FormProps['finalizeAvatarUpload']
}>

export function ProfileSettingsPage({
  user,
  requestAvatarUpload,
  finalizeAvatarUpload,
}: Props) {
  return (
    <ProfileSettingsForm
      user={user}
      requestAvatarUpload={requestAvatarUpload}
      finalizeAvatarUpload={finalizeAvatarUpload}
    />
  )
}

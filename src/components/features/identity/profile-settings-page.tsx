// Profile settings page — wrapper component that renders the profile settings form
// Per conventions: receives user data and serverFns from route context and renders the form.
import { ProfileSettingsForm, type Props as FormProps } from './profile-settings-form'

export type Props = Readonly<{
  user: FormProps['user']
  updateProfile: FormProps['updateProfile']
  requestAvatarUpload: FormProps['requestAvatarUpload']
  finalizeAvatarUpload: FormProps['finalizeAvatarUpload']
}>

export function ProfileSettingsPage({
  user,
  updateProfile,
  requestAvatarUpload,
  finalizeAvatarUpload,
}: Props) {
  return (
    <ProfileSettingsForm
      user={user}
      updateProfile={updateProfile}
      requestAvatarUpload={requestAvatarUpload}
      finalizeAvatarUpload={finalizeAvatarUpload}
    />
  )
}

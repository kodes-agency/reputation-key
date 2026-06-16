// Profile settings page — wrapper component that renders the profile settings form
// Per conventions: receives user data and serverFns from route context and renders the form.
import { ProfileSettingsForm, type Props as FormProps } from './profile-settings-form'

type Props = Readonly<{
  user: FormProps['user']
  updateProfile: FormProps['updateProfile']
  updateUserImage: FormProps['updateUserImage']
  requestAvatarUpload: FormProps['requestAvatarUpload']
  finalizeAvatarUpload: FormProps['finalizeAvatarUpload']
}>

export function ProfileSettingsPage({
  user,
  updateProfile,
  updateUserImage,
  requestAvatarUpload,
  finalizeAvatarUpload,
}: Props) {
  return (
    <ProfileSettingsForm
      user={user}
      updateProfile={updateProfile}
      updateUserImage={updateUserImage}
      requestAvatarUpload={requestAvatarUpload}
      finalizeAvatarUpload={finalizeAvatarUpload}
    />
  )
}

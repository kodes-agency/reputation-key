// Profile settings page — wrapper component that renders the profile settings form
// Per conventions: receives user data from route context and renders the form.
import { ProfileSettingsForm, type Props as FormProps } from './profile-settings-form'

export type Props = Readonly<{
  user: FormProps['user']
}>

export function ProfileSettingsPage({ user }: Props) {
  return <ProfileSettingsForm user={user} />
}

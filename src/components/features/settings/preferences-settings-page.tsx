import { useId } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { ThemeModeControl } from '#/components/layout/theme-mode-control'

export function PreferencesSettingsPage() {
  // Generated, not written, so two mounts (a story showing both themes) never
  // share one id and break the group's `aria-labelledby`.
  const themeLabelId = useId()
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize how the app looks on your device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <span id={themeLabelId} className="text-sm leading-none font-medium">
              Theme
            </span>
            <ThemeModeControl labelledBy={themeLabelId} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

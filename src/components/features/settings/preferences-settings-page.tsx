import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { ThemeModeControl } from '#/components/layout/theme-mode-control'

const THEME_LABEL_ID = 'preferences-theme-label'

export function PreferencesSettingsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize how the app looks on your device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <span id={THEME_LABEL_ID} className="text-sm leading-none font-medium">
              Theme
            </span>
            <ThemeModeControl labelledBy={THEME_LABEL_ID} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

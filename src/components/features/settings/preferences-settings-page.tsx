import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { ThemeToggle } from '#/components/layout/theme-toggle'
import { Bell } from 'lucide-react'

export function PreferencesSettingsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize how the app looks on your device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="theme-toggle">Theme</Label>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>

      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>
            Manage email and in-app notification preferences. Coming soon.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

// Response-SLA card — org-level "respond within N hours" setting.
// Backs the dashboard attention band (unanswered reviews past SLA). A simple
// number input + save; the value is validated 1–720 by the server.

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Button } from '#/components/ui/button'
import type { Action } from '#/components/hooks/use-action'

type SlaInput = Readonly<{ data: Readonly<{ responseSlaHours: number }> }>

type Props = Readonly<{
  responseSlaHours: number
  updateSla: Action<SlaInput, { responseSlaHours: number }>
}>

export function ResponseSlaCard({ responseSlaHours, updateSla }: Props) {
  const [value, setValue] = useState(String(responseSlaHours))

  const parsed = Number.parseInt(value, 10)
  const isValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 720
  const isDirty = parsed !== responseSlaHours

  const onSave = async () => {
    if (!isValid) return
    try {
      await updateSla({ data: { responseSlaHours: parsed } })
    } catch {
      toast.error('Failed to update response SLA')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Response SLA</CardTitle>
        <CardDescription>
          Target time (in hours) for responding to new reviews. Drives the dashboard
          attention band for overdue responses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3">
          <div className="grid w-32 gap-1.5">
            <Label htmlFor="response-sla-hours">Hours</Label>
            <Input
              id="response-sla-hours"
              type="number"
              min={1}
              max={720}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button onClick={onSave} disabled={!isValid || !isDirty || updateSla.isPending}>
            {updateSla.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {!isValid && (
          <p className="mt-2 text-xs text-destructive">
            Enter a whole number between 1 and 720.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

import type { RecognitionSettings } from '#/contexts/leaderboard/application/public-api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Label } from '#/components/ui/label'

type Metric = RecognitionSettings['availableMetrics'][number]

type RecognitionActivationCardProps = Readonly<{
  settings: RecognitionSettings
  active: boolean
  selectedMetric: Metric | undefined
  metricVersionId: string
  selectedGroups: readonly string[]
  jurisdiction: string
  consultationStatus: 'completed' | 'not_required'
  minimumExposure: number
  minimumSample: number
  freshnessSeconds: number
  minimumCompleteness: number
  periodKind: 'weekly' | 'monthly' | 'quarterly'
  pending: boolean
  setJurisdiction: (value: string) => void
  setConsultationStatus: (value: 'completed' | 'not_required') => void
  selectMetric: (versionId: string) => void
  toggleGroup: (groupId: string, checked: boolean) => void
  setPeriodKind: (value: 'weekly' | 'monthly' | 'quarterly') => void
  setMinimumExposure: (value: number) => void
  setMinimumSample: (value: number) => void
  setFreshnessSeconds: (value: number) => void
  setMinimumCompleteness: (value: number) => void
  activate: () => void
}>

export function RecognitionActivationCard(props: RecognitionActivationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Property recognition activation</CardTitle>
        <CardDescription>
          Positive portal-group coaching and celebration only. Recognition is never
          eligible for employment decisions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2">
          <Label htmlFor="recognition-jurisdiction">Jurisdiction</Label>
          <input
            id="recognition-jurisdiction"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            maxLength={80}
            value={props.jurisdiction}
            onChange={(event) => props.setJurisdiction(event.target.value)}
            placeholder="For example, US-CA"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="recognition-consultation">Consultation status</Label>
          <select
            id="recognition-consultation"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={props.consultationStatus}
            onChange={(event) =>
              props.setConsultationStatus(
                event.target.value as 'completed' | 'not_required',
              )
            }
          >
            <option value="not_required">Not required</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="recognition-metric">Governed metric version</Label>
          <select
            id="recognition-metric"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={props.metricVersionId}
            onChange={(event) => props.selectMetric(event.target.value)}
          >
            {props.settings.availableMetrics.map((metric) => (
              <option key={metric.definitionVersionId} value={metric.definitionVersionId}>
                {metric.displayName} · {metric.aggregation}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Included portal groups</legend>
          {props.settings.availablePortalGroups.map((group) => (
            <label key={group.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={props.selectedGroups.includes(group.id)}
                onChange={(event) => props.toggleGroup(group.id, event.target.checked)}
              />
              {group.name}
            </label>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm">
            Period
            <select
              className="rounded-md border bg-background px-3 py-2"
              value={props.periodKind}
              onChange={(event) =>
                props.setPeriodKind(event.target.value as typeof props.periodKind)
              }
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Minimum exposure
            <input
              type="number"
              min={1}
              value={props.minimumExposure}
              onChange={(event) => props.setMinimumExposure(Number(event.target.value))}
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Minimum sample
            <input
              type="number"
              min={props.selectedMetric?.minimumSample ?? 1}
              value={props.minimumSample}
              onChange={(event) => props.setMinimumSample(Number(event.target.value))}
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Minimum completeness
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={props.minimumCompleteness}
              onChange={(event) =>
                props.setMinimumCompleteness(Number(event.target.value))
              }
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Freshness window (seconds)
            <input
              type="number"
              min={1}
              value={props.freshnessSeconds}
              onChange={(event) => props.setFreshnessSeconds(Number(event.target.value))}
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>
        </div>

        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={
            props.pending ||
            !props.selectedMetric ||
            props.selectedGroups.length === 0 ||
            !props.jurisdiction.trim()
          }
          onClick={props.activate}
        >
          {props.active ? 'Save new activation version' : 'Activate recognition'}
        </button>
      </CardContent>
    </Card>
  )
}

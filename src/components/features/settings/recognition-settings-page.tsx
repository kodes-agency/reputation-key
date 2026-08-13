import { useState } from 'react'
import type {
  ActivateRecognitionInput,
  DeactivateRecognitionInput,
} from '#/contexts/leaderboard/application/dto/leaderboard.dto'
import type { RecognitionSettings } from '#/contexts/leaderboard/application/public-api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { RecognitionActivationCard } from './recognition-activation-card'

type Props = Readonly<{
  propertyId: string
  settings: RecognitionSettings
  activate: (input: { data: ActivateRecognitionInput }) => Promise<unknown>
  deactivate: (input: { data: DeactivateRecognitionInput }) => Promise<unknown>
}>

export function RecognitionSettingsPage({
  propertyId,
  settings,
  activate,
  deactivate,
}: Props) {
  const current = settings.activation
  const initialMetric =
    settings.availableMetrics.find(
      (metric) => metric.definitionVersionId === current?.metricDefinitionVersionId,
    ) ?? settings.availableMetrics[0]
  const [metricVersionId, setMetricVersionId] = useState(
    initialMetric?.definitionVersionId ?? '',
  )
  const [selectedGroups, setSelectedGroups] = useState<string[]>(
    current ? [...current.selectedPortalGroupIds] : [],
  )
  const [jurisdiction, setJurisdiction] = useState(current?.jurisdiction ?? '')
  const [consultationStatus, setConsultationStatus] = useState<
    'completed' | 'not_required'
  >(current?.consultationStatus ?? 'not_required')
  const [minimumExposure, setMinimumExposure] = useState(current?.minimumExposure ?? 5)
  const [minimumSample, setMinimumSample] = useState(
    current?.minimumSample ?? initialMetric?.minimumSample ?? 5,
  )
  const [freshnessSeconds, setFreshnessSeconds] = useState(
    current?.freshnessSeconds ?? 86_400,
  )
  const [minimumCompleteness, setMinimumCompleteness] = useState(
    current?.minimumCompleteness ?? 0.9,
  )
  const [periodKind, setPeriodKind] = useState<'weekly' | 'monthly' | 'quarterly'>(
    current?.periodKind ?? 'monthly',
  )
  const [deactivationReason, setDeactivationReason] = useState('')
  const [pending, setPending] = useState(false)

  const selectedMetric = settings.availableMetrics.find(
    (metric) => metric.definitionVersionId === metricVersionId,
  )

  const toggleGroup = (groupId: string, checked: boolean) => {
    setSelectedGroups((groups) =>
      checked
        ? [...new Set([...groups, groupId])]
        : groups.filter((id) => id !== groupId),
    )
  }

  const activateRecognition = async () => {
    if (!selectedMetric || selectedGroups.length === 0 || !jurisdiction.trim()) return
    setPending(true)
    try {
      await activate({
        data: {
          propertyId,
          policyVersion: 'beta-local-1',
          jurisdiction: jurisdiction.trim(),
          noticeStatus: 'completed',
          consultationStatus,
          audience: 'property_managers_and_scoped_staff',
          selectedPortalGroupIds: selectedGroups,
          metricDefinitionVersionId: selectedMetric.definitionVersionId,
          aggregation: selectedMetric.aggregation,
          periodKind,
          minimumExposure,
          minimumSample,
          freshnessSeconds,
          minimumCompleteness,
        },
      })
    } finally {
      setPending(false)
    }
  }

  const deactivateRecognition = async () => {
    if (!deactivationReason.trim()) return
    setPending(true)
    try {
      await deactivate({
        data: { propertyId, reason: deactivationReason.trim() },
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <RecognitionActivationCard
        settings={settings}
        active={current !== null}
        selectedMetric={selectedMetric}
        metricVersionId={metricVersionId}
        selectedGroups={selectedGroups}
        jurisdiction={jurisdiction}
        consultationStatus={consultationStatus}
        minimumExposure={minimumExposure}
        minimumSample={minimumSample}
        freshnessSeconds={freshnessSeconds}
        minimumCompleteness={minimumCompleteness}
        periodKind={periodKind}
        pending={pending}
        setJurisdiction={setJurisdiction}
        setConsultationStatus={setConsultationStatus}
        selectMetric={(versionId) => {
          setMetricVersionId(versionId)
          const metric = settings.availableMetrics.find(
            (candidate) => candidate.definitionVersionId === versionId,
          )
          if (metric) setMinimumSample(metric.minimumSample)
        }}
        toggleGroup={toggleGroup}
        setPeriodKind={setPeriodKind}
        setMinimumExposure={setMinimumExposure}
        setMinimumSample={setMinimumSample}
        setFreshnessSeconds={setFreshnessSeconds}
        setMinimumCompleteness={setMinimumCompleteness}
        activate={activateRecognition}
      />

      {current ? (
        <Card>
          <CardHeader>
            <CardTitle>Deactivate recognition</CardTitle>
            <CardDescription>
              Deactivation immediately removes board visibility and stops future
              refreshes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Label htmlFor="recognition-deactivation" className="sr-only">
              Deactivation reason
            </Label>
            <input
              id="recognition-deactivation"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              value={deactivationReason}
              onChange={(event) => setDeactivationReason(event.target.value)}
              placeholder="Reason for deactivation"
            />
            <button
              type="button"
              className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
              disabled={pending || !deactivationReason.trim()}
              onClick={deactivateRecognition}
            >
              Deactivate
            </button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

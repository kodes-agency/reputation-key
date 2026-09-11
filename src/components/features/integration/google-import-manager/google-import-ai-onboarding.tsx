import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BrainCircuit, CheckCircle2 } from 'lucide-react'
import type {
  CurrentMerchantAiCapability,
  MerchantAiSnapshot,
} from '#/contexts/identity/application/public-api'
import type { MerchantAiNoticeDto } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { MerchantAiAuthorizationCard } from '#/components/features/settings/merchant-ai-authorization-card'
import { identityKeys } from '#/shared/queries/query-keys'
import type { GoogleImportAiFns } from './google-import-manager-contract'
import type { ImportedPropertyForAi } from './google-import-progress-model'

type Props = Readonly<{
  properties: readonly ImportedPropertyForAi[]
  aiFns: GoogleImportAiFns
}>

function mutationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'AI analysis could not be enabled. Reload this page and try again.'
}

/**
 * The AI-analysis step of the import flow: one consent card per Property the
 * import produced, rendered with the same notice, capability set and password
 * step-up as Settings → AI & replies, so the evidence recorded is identical
 * whichever door the merchant used. Nothing is analysed until they enable it;
 * skipping leaves the property exactly as an import without this step would.
 */
export function GoogleImportAiOnboarding({ properties, aiFns }: Props) {
  if (properties.length === 0) return null
  return (
    <section
      aria-labelledby="google-import-ai-onboarding-title"
      className="flex flex-col gap-4 border-t pt-6"
    >
      <div className="flex items-start gap-3">
        <BrainCircuit aria-hidden="true" className="mt-0.5 size-5 text-primary" />
        <div>
          <h2
            id="google-import-ai-onboarding-title"
            className="text-xl font-semibold tracking-tight"
          >
            AI analysis
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reviews are in the inbox. Choose per property whether RepKey may analyse them;
            nothing is sent to the AI provider until you enable it here or in Settings.
          </p>
        </div>
      </div>
      {properties.map((property) => (
        <PropertyAiDecision key={property.propertyId} property={property} aiFns={aiFns} />
      ))}
    </section>
  )
}

function PropertyAiDecision({
  property,
  aiFns,
}: Readonly<{ property: ImportedPropertyForAi; aiFns: GoogleImportAiFns }>) {
  const authorization = useQuery({
    queryKey: identityKeys.merchantAiAuthorization(property.propertyId),
    queryFn: ({ signal }) =>
      aiFns.getMerchantAiAuthorization({
        data: { propertyId: property.propertyId },
        signal,
      }),
    staleTime: 30_000,
  })
  const [skipped, setSkipped] = useState(false)
  const [snapshot, setSnapshot] = useState<MerchantAiSnapshot | null | undefined>(
    undefined,
  )

  if (authorization.isPending) {
    return (
      <div
        aria-label={`Loading AI settings for ${property.propertyName}`}
        className="flex flex-col gap-3 rounded-xl border p-6"
      >
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <Skeleton className="h-9 w-40" />
      </div>
    )
  }
  if (authorization.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>AI settings unavailable for {property.propertyName}</AlertTitle>
        <AlertDescription>
          You can enable AI analysis later from Settings → AI &amp; replies.
        </AlertDescription>
      </Alert>
    )
  }

  const current = snapshot === undefined ? authorization.data.authorization : snapshot
  if (current?.state === 'enabled') {
    return <EnabledPanel property={property} />
  }
  if (skipped) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-medium">{property.propertyName}</span>
          <span className="text-muted-foreground">
            {' '}
            — AI analysis stays off. Enable it any time from Settings → AI &amp; replies.
          </span>
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setSkipped(false)}>
          Reconsider
        </Button>
      </div>
    )
  }
  return (
    <ConsentCard
      property={property}
      snapshot={current}
      notice={authorization.data.notice}
      enable={aiFns.enableMerchantAi}
      onEnabled={setSnapshot}
      onSkip={() => setSkipped(true)}
    />
  )
}

function ConsentCard({
  property,
  snapshot,
  notice,
  enable,
  onEnabled,
  onSkip,
}: Readonly<{
  property: ImportedPropertyForAi
  snapshot: MerchantAiSnapshot | null
  notice: MerchantAiNoticeDto
  enable: GoogleImportAiFns['enableMerchantAi']
  onEnabled: (snapshot: MerchantAiSnapshot) => void
  onSkip: () => void
}>) {
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // The onboarding card enables the full capability set the notice describes;
  // per-capability choices stay in Settings, where the merchant can revisit.
  const selectedCapabilities: ReadonlyArray<CurrentMerchantAiCapability> =
    notice.payload.capabilities.map((capability) => capability.id)

  const runEnable = async () => {
    setPending(true)
    setErrorMessage(null)
    try {
      const next = await enable({
        data: {
          propertyId: property.propertyId,
          expectedStateVersion: snapshot?.stateVersion ?? 0,
          idempotencyKey: crypto.randomUUID(),
          password,
        },
      })
      onEnabled(next)
    } catch (error) {
      setErrorMessage(mutationErrorMessage(error))
    } finally {
      setPassword('')
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <MerchantAiAuthorizationCard
        propertyName={property.propertyName}
        state={snapshot?.state ?? 'disabled'}
        // An `imported`/`relinked` item means the Google binding is active; the
        // server re-checks it when the transition is applied.
        sourceActive
        notice={notice}
        selectedCapabilities={selectedCapabilities}
        password={password}
        pending={pending}
        errorMessage={errorMessage}
        canSubmit={Boolean(password) && !pending}
        canSave={false}
        onToggleCapability={() => undefined}
        onPasswordChange={setPassword}
        onEnable={() => void runEnable()}
        onChange={() => undefined}
        onRevoke={() => undefined}
      />
      <div>
        <Button type="button" variant="ghost" onClick={onSkip} disabled={pending}>
          Not now for {property.propertyName}
        </Button>
      </div>
    </div>
  )
}

function EnabledPanel({ property }: Readonly<{ property: ImportedPropertyForAi }>) {
  return (
    <Alert>
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>AI analysis is on for {property.propertyName}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Existing reviews are being analysed now and new ones are analysed as they
          arrive. Insights fill in as each analysis lands.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link
              to="/properties/$propertyId/insights"
              params={{ propertyId: property.propertyId }}
              search={{ range: 90 }}
            >
              View insights
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/settings/ai" search={{ propertyId: property.propertyId }}>
              AI settings
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

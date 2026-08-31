import type { PortalPublicationHistory } from '#/contexts/portal/application/public-api'

export function PortalSavedSettingsStatus({
  history,
}: Readonly<{ history: PortalPublicationHistory }>) {
  if (history.hasPendingChanges) {
    return (
      <p className="text-sm text-muted-foreground">
        {history.current
          ? 'Saved changes are ready for the next publication. Guests continue to see the live version until you publish again.'
          : 'Saved changes are ready for the next publication. They will appear when the public page is published again.'}
      </p>
    )
  }
  if (history.current) {
    return (
      <p className="text-sm text-muted-foreground">
        Saved settings match the live version.
      </p>
    )
  }
  if (history.priorActivations.length > 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Saved settings match the most recently published version.
      </p>
    )
  }
  return (
    <p className="text-sm text-muted-foreground">
      Your first version will appear here after publication.
    </p>
  )
}

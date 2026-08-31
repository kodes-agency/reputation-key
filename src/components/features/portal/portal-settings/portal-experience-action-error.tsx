import type { Action } from '#/components/hooks/use-action'

export function PortalExperienceActionError({
  action,
}: Readonly<{ action: Pick<Action<unknown>, 'error'> }>) {
  if (!action.error) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {action.error instanceof Error
        ? action.error.message
        : 'The change could not be saved.'}
    </p>
  )
}

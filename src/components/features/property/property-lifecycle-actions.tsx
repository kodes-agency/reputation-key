// The lifecycle controls a Property currently offers, and the errors they raise.
//
// Split from the card so the card is about what the Property *is*, and this is
// about what you can *do* to it. Every show/disable rule is decided in
// property-lifecycle-model.ts; nothing here branches on permissions itself.
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import {
  PropertyArchiveDialog,
  PropertyGoogleDisconnectDialog,
  PropertyRemoveDialog,
  PropertyRestoreDialog,
  type ArchiveLifecycleAction,
  type TargetLifecycleAction,
} from './property-lifecycle-dialogs'
import {
  getPropertyLifecycleActionStates,
  type LifecycleControls,
  type LifecyclePermissions,
} from './property-lifecycle-model'

export type PropertyLifecycleActionSet = Readonly<{
  archive: ArchiveLifecycleAction
  remove: ArchiveLifecycleAction
  restore: TargetLifecycleAction
  disconnect: TargetLifecycleAction
}>

export function PropertyLifecycleActions({
  property,
  controls,
  permissions,
  actions,
}: Readonly<{
  property: Readonly<{ id: string; name: string }>
  controls: LifecycleControls
  permissions: LifecyclePermissions
  actions: PropertyLifecycleActionSet
}>) {
  const pending =
    actions.archive.isPending ||
    actions.remove.isPending ||
    actions.restore.isPending ||
    actions.disconnect.isPending
  const states = getPropertyLifecycleActionStates({ controls, permissions, pending })

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {states.archive.show && (
          <PropertyArchiveDialog
            propertyId={property.id}
            propertyName={property.name}
            action={actions.archive}
            disabled={states.archive.disabled}
          />
        )}

        {states.remove.show && (
          <PropertyRemoveDialog
            propertyId={property.id}
            propertyName={property.name}
            action={actions.remove}
            disabled={states.remove.disabled}
          />
        )}

        {states.restore.show && (
          <PropertyRestoreDialog
            propertyId={property.id}
            propertyName={property.name}
            action={actions.restore}
            disabled={states.restore.disabled}
          />
        )}

        {states.disconnect.show && (
          <PropertyGoogleDisconnectDialog
            propertyId={property.id}
            propertyName={property.name}
            action={actions.disconnect}
            disabled={states.disconnect.disabled}
          />
        )}
      </div>

      <FormErrorBanner
        error={
          actions.archive.error ??
          actions.remove.error ??
          actions.restore.error ??
          actions.disconnect.error
        }
      />
    </>
  )
}

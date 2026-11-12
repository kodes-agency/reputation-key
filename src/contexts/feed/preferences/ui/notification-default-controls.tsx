import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { InheritedSetting } from '#/components/forms/inherited-setting'
import { Button } from '#/components/ui/button'
import type { ConfigurableNotificationCategory } from '#/contexts/feed/application/public-api'
import { namesInBrief, type SetDifferently } from './notification-apply-everywhere'
import { categoryInSentence } from './notifications-type-rows'

// Every row repeats "In-app", "Email", "Cadence" and "Quiet from", so each
// control's name carries the category: a screen-reader user tabbing through
// otherwise cannot tell which category a control changes.
export const named = (categoryLabel: string, control: string) =>
  `${categoryLabel}: ${control}`

/**
 * The person's default for a category: what every property without a setting
 * of its own gets, including the ones they are given next.
 *
 * Making the answer at this property the default never touches another
 * property's own setting: those are named beneath it, and resetting them
 * is a choice of its own, confirmed.
 */
export function DefaultControls({
  category,
  categoryLabel,
  inherited,
  setDifferently,
  ownHere,
  applyToAll,
  resetToDefault,
  propertyInView,
}: Readonly<{
  category: ConfigurableNotificationCategory
  categoryLabel: string
  inherited: string
  /** The other properties with a setting of their own, which keep it. */
  setDifferently: ReadonlyArray<SetDifferently>
  /** This property has a setting of its own for the category. */
  ownHere: boolean
  applyToAll: (category: ConfigurableNotificationCategory) => Promise<void>
  resetToDefault: (
    category: ConfigurableNotificationCategory,
    propertyIds: ReadonlyArray<string>,
  ) => Promise<void>
  propertyInView: string
}>) {
  const noteId = `${category}-inherited`
  const count = setDifferently.length
  const includesMute = setDifferently.some((property) => property.muted)
  const propertyIds = setDifferently.map((property) => property.id)
  const propertyNames = namesInBrief(setDifferently.map((property) => property.name))
  return (
    <InheritedSetting
      source="your default"
      overridden={ownHere}
      commit="immediate"
      inheritLabel="Use my default here"
      inheritAccessibleName={named(categoryLabel, 'Use my default here')}
      onInherit={() => void resetToDefault(category, [propertyInView])}
      noteId={noteId}
      note={
        <>
          {inherited}
          {count > 0 && (
            <>
              {' '}
              {propertyNames} {count === 1 ? 'keeps its' : 'keep their'} own setting
              {includesMute ? ', including a mute from the notification bell' : ''}.
            </>
          )}
        </>
      }
      className="md:col-span-3 md:col-start-1"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={named(categoryLabel, 'Make this my default')}
        aria-describedby={noteId}
        onClick={() => void applyToAll(category)}
      >
        Make this my default
      </Button>
      {count > 0 && (
        <ConfirmationDialog
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // The name holds the visible words (WCAG 2.5.3, label in name);
              // the category tells a screen reader which row's reset it is.
              aria-label={named(
                categoryLabel,
                `Reset ${count === 1 ? 'it' : 'them'} to my default`,
              )}
            >
              Reset {count === 1 ? 'it' : 'them'} to my default
            </Button>
          }
          title={`Reset ${count} ${count === 1 ? 'property' : 'properties'} to your default?`}
          description={`${propertyNames} ${
            count === 1 ? 'loses its' : 'lose their'
          } own ${categoryInSentence(category)} settings${
            includesMute ? ', including a mute from the notification bell,' : ''
          } and ${count === 1 ? 'follows' : 'follow'} your default instead.`}
          cancelLabel="Keep them"
          confirmLabel="Reset"
          pendingLabel="Resetting…"
          onConfirm={() => resetToDefault(category, propertyIds)}
        />
      )}
    </InheritedSetting>
  )
}

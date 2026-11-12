import type { EffectiveNotificationSettings } from '#/contexts/feed/application/public-api'
import type { NotificationFormattingValues } from '#/contexts/feed/preferences/contracts'

/**
 * The saved settings an open timezone and format form edits against. A newer
 * read (a refetch, another tab's save, this form's own save) replaces them
 * only while the form holds no edit, or once the edit is what was saved: an
 * unsaved edit keeps the values it started from, so neither the edit nor the
 * other field's saved value is lost, and a save sends only what was changed.
 */
export function formattingBaseline(
  baseline: EffectiveNotificationSettings,
  latest: EffectiveNotificationSettings,
  /** The form's values while they differ from its baseline; null when it holds no edit. */
  draft: NotificationFormattingValues | null,
): EffectiveNotificationSettings {
  if (latest === baseline || draft === null) return latest
  const saved = draft.locale === latest.locale && draft.timezone === latest.timezone
  return saved ? latest : baseline
}

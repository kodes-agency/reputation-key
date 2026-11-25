/**
 * Date-plus-time text that is byte-identical across JavaScript engines.
 *
 * Server-rendered timestamps must hydrate to the same string the browser
 * produces. Pinning the locale and the time zone is not enough: engines glue
 * the date and the time differently — Node/V8 (ICU) emit
 * `Aug 23, 2026, 8:00 AM`, WebKit/JavaScriptCore emits `Aug 23, 2026 at 8:00 AM`
 * for the same `Intl.DateTimeFormat` options — which is exactly the React #418
 * hydration mismatch the compatibility gate saw on Safari and iOS. Formatting
 * the date and the time separately and joining them here keeps the glue ours.
 */
export function formatDateTime(
  value: Date,
  options: Readonly<{ locale: string; timeZone: string; timeZoneName?: boolean }>,
): string {
  const { locale, timeZone } = options
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(
    value,
  )
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    ...(options.timeZoneName ? { timeZoneName: 'short' as const } : {}),
  }).format(value)
  return `${date}, ${time}`
}

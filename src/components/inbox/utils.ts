// Inbox shared formatting utilities

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(typeof date === 'string' ? new Date(date) : date)
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(typeof date === 'string' ? new Date(date) : date)
}

export function formatInboxListDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(typeof date === 'string' ? new Date(date) : date)
}

export function formatReviewLanguage(languageCode: string | null | undefined) {
  if (!languageCode) return null
  try {
    const language = new Intl.Locale(languageCode.replaceAll('_', '-')).language
    const label = new Intl.DisplayNames(['en'], { type: 'language' }).of(language)
    return label && label.toLocaleLowerCase() !== language.toLocaleLowerCase()
      ? label
      : null
  } catch {
    return null
  }
}

// Feed notification surface — the email cadences each category offers.
//
// Kept out of notification-policy.ts on purpose: the client build puts that
// module in a chunk first paint loads, and only Settings and the server need
// these. Here they land in the Settings chunk instead (-53 B gzip of first
// paint, measured 2026-09-22).

import type { NotificationCadence, NotificationCategory } from './notification-types'
import { getDefaultCadence } from './notification-policy'

const EVERY_EMAIL_CADENCE: readonly NotificationCadence[] = ['immediate', 'daily']
const DAILY_EMAIL_ONLY: readonly NotificationCadence[] = ['daily']

/**
 * Email cadences a person may choose for a category. Goals (`recognition`)
 * are a daily digest only: one Program over up to 250 Portals closes its
 * results in the same hour, and an immediate cadence would send each as its
 * own email (ADR 0046, amended 2026-09-22).
 */
export function offeredEmailCadences(
  category: NotificationCategory,
): readonly NotificationCadence[] {
  return category === 'recognition' ? DAILY_EMAIL_ONLY : EVERY_EMAIL_CADENCE
}

/**
 * The cadence email is actually sent at. A stored cadence the category no
 * longer offers (a goal row saved as immediate before it became daily-only)
 * falls back to the category default rather than being honoured.
 */
export function effectiveEmailCadence(
  category: NotificationCategory,
  stored: NotificationCadence | undefined,
): NotificationCadence {
  return stored !== undefined && offeredEmailCadences(category).includes(stored)
    ? stored
    : getDefaultCadence(category)
}

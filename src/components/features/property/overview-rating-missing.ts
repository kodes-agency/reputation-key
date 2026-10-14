// What the Overview's Rating tile says when there is no Google number to show:
// Google never sent numbers for the Property's current binding. While the link
// is active that is a wait; otherwise it is the link, and the tile says what to
// do about it rather than to wait (pure).
import type { GoogleBindingState } from './property-lifecycle-model'

export function overviewRatingMissing(state: GoogleBindingState): string {
  switch (state) {
    case 'active':
      return 'Google hasn’t sent this property’s rating yet.'
    case 'unbound':
      return 'Link Google to see this property’s rating.'
    case 'disconnected':
      return 'Reconnect Google to see this property’s rating.'
    case 'account_confirmation_required':
      return 'Confirm the Google account to see this property’s rating.'
  }
}

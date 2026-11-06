import { getGuestVoiceV2Fn } from '#/contexts/ai/server/guest-voice-v2'
import { getGuestVoiceDetailFn } from '#/contexts/ai/server/guest-voice-details'
import { getPropertyGoogleNumbersFn } from '#/contexts/reporting/server/property-google-numbers'

export const guestVoiceFns = {
  getGuestVoicePage: getGuestVoiceV2Fn,
  getGuestVoiceDetail: getGuestVoiceDetailFn,
  getGuestVoiceGoogle: getPropertyGoogleNumbersFn,
}

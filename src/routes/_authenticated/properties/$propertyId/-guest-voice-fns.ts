// Keep server stubs out of shared first-paint chunks.
const getGuestVoicePage = async (
  input: Parameters<
    (typeof import('#/contexts/ai/server/guest-voice-v2'))['getGuestVoiceV2Fn']
  >[0],
) => (await import('#/contexts/ai/server/guest-voice-v2')).getGuestVoiceV2Fn(input)
const getGuestVoiceDetail = async (
  input: Parameters<
    (typeof import('#/contexts/ai/server/guest-voice-details'))['getGuestVoiceDetailFn']
  >[0],
) =>
  (await import('#/contexts/ai/server/guest-voice-details')).getGuestVoiceDetailFn(input)
const getGuestVoiceGoogle = async (
  input: Parameters<
    (typeof import('#/contexts/reporting/server/property-google-numbers'))['getPropertyGoogleNumbersFn']
  >[0],
) =>
  (
    await import('#/contexts/reporting/server/property-google-numbers')
  ).getPropertyGoogleNumbersFn(input)

export const guestVoiceFns = {
  get getGuestVoicePage() {
    return getGuestVoicePage
  },
  get getGuestVoiceDetail() {
    return getGuestVoiceDetail
  },
  get getGuestVoiceGoogle() {
    return getGuestVoiceGoogle
  },
}

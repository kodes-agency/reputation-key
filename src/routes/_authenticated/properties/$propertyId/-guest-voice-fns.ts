// Keep server stubs out of shared first-paint chunks.
export const getGuestVoicePage = async (
  input: Parameters<
    (typeof import('#/contexts/ai/server/guest-voice-v2'))['getGuestVoiceV2Fn']
  >[0],
) => (await import('#/contexts/ai/server/guest-voice-v2')).getGuestVoiceV2Fn(input)
export const getGuestVoiceDetail = async (
  input: Parameters<
    (typeof import('#/contexts/ai/server/guest-voice-details'))['getGuestVoiceDetailFn']
  >[0],
) =>
  (await import('#/contexts/ai/server/guest-voice-details')).getGuestVoiceDetailFn(input)
export const getGuestVoiceGoogle = async (
  input: Parameters<
    (typeof import('#/contexts/reporting/server/property-google-numbers'))['getPropertyGoogleNumbersFn']
  >[0],
) =>
  (
    await import('#/contexts/reporting/server/property-google-numbers')
  ).getPropertyGoogleNumbersFn(input)

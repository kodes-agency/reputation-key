import type { MerchantAiNoticeUpdateClient } from '#/shared/merchant-ai-notice-announcements'

// The AI notice update's two calls, for the settings banner and for What's new
// (which leads with the same update). Both are lazy chunks, and the server module
// arrives with the first call, so nothing here is first paint. A component never
// imports the server module; it receives this client.
const server = () => import('#/contexts/identity/server/merchant-ai-notice-updates')

export const merchantAiNoticeUpdateClient: MerchantAiNoticeUpdateClient = {
  get: async () => (await server()).getMerchantAiNoticeUpdateFn(),
  markSeen: async (input) => (await server()).markMerchantAiNoticeUpdateSeenFn(input),
}

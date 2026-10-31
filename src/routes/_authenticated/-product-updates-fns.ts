import { merchantAiNoticeUpdateClient } from './-merchant-ai-notice-update-client'

// This bundle and its query consumers are loaded only after first paint.
//
// Getters, not an object literal: `route-server-fn-bundles.test.ts` guards the shape
// of every `-*-fns.ts`, because a value read while the module evaluates can freeze
// `undefined` into a bundle that sits inside an import cycle. The server module
// itself arrives with the first call.
type Server = typeof import('#/contexts/identity/server/product-updates')
const server = () => import('#/contexts/identity/server/product-updates')

export const productUpdatesFns = {
  get get() {
    return async (input: Parameters<Server['getProductUpdatesFn']>[0]) =>
      (await server()).getProductUpdatesFn(input)
  },
  get claim() {
    return async (input: Parameters<Server['claimProductUpdatesAutoOpenFn']>[0]) =>
      (await server()).claimProductUpdatesAutoOpenFn(input)
  },
  get markSeen() {
    return async (input: Parameters<Server['markProductUpdatesSeenFn']>[0]) =>
      (await server()).markProductUpdatesSeenFn(input)
  },
  get setAutoShow() {
    return async (input: Parameters<Server['setProductUpdatesAutoShowFn']>[0]) =>
      (await server()).setProductUpdatesAutoShowFn(input)
  },
  // The AI update an AccountAdmin is told first: the settings banner's own calls.
  get aiNoticeUpdate() {
    return merchantAiNoticeUpdateClient
  },
}

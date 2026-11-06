import {
  getProductUpdatesFn,
  claimProductUpdatesAutoOpenFn,
  markProductUpdatesSeenFn,
  setProductUpdatesAutoShowFn,
} from '#/contexts/identity/server/product-updates'
import { merchantAiNoticeUpdateClient } from './-merchant-ai-notice-update-client'

export const productUpdatesFns = {
  get: getProductUpdatesFn,
  claim: claimProductUpdatesAutoOpenFn,
  markSeen: markProductUpdatesSeenFn,
  setAutoShow: setProductUpdatesAutoShowFn,
  aiNoticeUpdate: merchantAiNoticeUpdateClient,
}

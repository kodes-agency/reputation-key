import { PRODUCT_UPDATES } from '../../src/shared/whats-new/entries'
import {
  getMerchantAiNoticeUpdateFn,
  markMerchantAiNoticeUpdateSeenFn,
} from './merchant-ai-notice-updates-server'
import type {
  ProductUpdatesClient,
  ProductUpdatesView,
} from '../../src/shared/whats-new/types'

export const productUpdatesStoryState = {
  view: {
    entries: PRODUCT_UPDATES,
    unseenIds: PRODUCT_UPDATES.map(({ id }) => id),
    autoShow: true,
    shouldAutoOpen: false,
  } as ProductUpdatesView,
  failSave: false,
  /** How many times the page asked for the view: two consumers of one query make one. */
  reads: 0,
  /** How many times the page asked to open the modal by itself, and whether it won. */
  claims: 0,
  claimWins: false,
}
export const getProductUpdatesFn = async () => {
  productUpdatesStoryState.reads += 1
  return productUpdatesStoryState.view
}
export const claimProductUpdatesAutoOpenFn = async () => {
  productUpdatesStoryState.claims += 1
  return productUpdatesStoryState.claimWins
}
export const markProductUpdatesSeenFn = async ({
  data,
}: {
  data: { entryIds: string[] }
}) => {
  productUpdatesStoryState.view = {
    ...productUpdatesStoryState.view,
    unseenIds: productUpdatesStoryState.view.unseenIds.filter(
      (id) => !data.entryIds.includes(id),
    ),
  }
}
export const setProductUpdatesAutoShowFn = async ({
  data,
}: {
  data: { autoShow: boolean }
}) => {
  await new Promise((resolve) => setTimeout(resolve, 200))
  if (productUpdatesStoryState.failSave) throw new Error('Story save failure')
  productUpdatesStoryState.view = {
    ...productUpdatesStoryState.view,
    autoShow: data.autoShow,
  }
}

export const productUpdatesStoryClient: ProductUpdatesClient = {
  get: getProductUpdatesFn,
  claim: claimProductUpdatesAutoOpenFn,
  markSeen: markProductUpdatesSeenFn,
  setAutoShow: setProductUpdatesAutoShowFn,
  aiNoticeUpdate: {
    get: getMerchantAiNoticeUpdateFn,
    markSeen: markMerchantAiNoticeUpdateSeenFn,
  },
}

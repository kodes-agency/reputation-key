import { getPortalLinkTapsFn } from '#/contexts/reporting/server/portal-analytics'

/** Getter bundle: preserve the server function’s boundary marker. */
export const portalResultsFns = {
  get getLinkTaps() {
    return getPortalLinkTapsFn
  },
}

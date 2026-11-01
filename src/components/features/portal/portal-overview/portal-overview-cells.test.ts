import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortalMetaLine } from './portal-overview-cells'
import { overviewRow } from './portal-overview-fixtures'
import { buildPortalOverview } from './portal-overview-view'

describe('Portal metadata', () => {
  it.each([false, true])(
    'shows Skips rating only when switched: %s',
    (skipPrivateRating) => {
      const row = overviewRow('portal', { skipPrivateRating })
      const item = buildPortalOverview([row], {}, []).sections[0]?.items[0]
      if (!item) throw new Error('The Portal row must be present')
      const html = renderToStaticMarkup(
        createElement(PortalMetaLine, { item, showGroup: false }),
      )
      expect(html.includes('Skips rating')).toBe(skipPrivateRating)
    },
  )
})

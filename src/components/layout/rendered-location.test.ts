// Frames and sidebars follow the page that is on screen, not the address the
// router is heading for. The hook reads the router's presented matches; the rule
// (the deepest one wins) is checked here without a router.
import { describe, expect, it } from 'vitest'
import { renderedLocationFromMatches } from './rendered-location'

const PROPERTY = '10000000-0000-4000-8000-000000000001'

describe('renderedLocationFromMatches', () => {
  it('is the deepest presented match, whatever lies above it', () => {
    const location = renderedLocationFromMatches([
      { pathname: '/' },
      { pathname: `/properties/${PROPERTY}` },
      { pathname: `/properties/${PROPERTY}/reviews`, search: { range: '30d' } },
    ])

    expect(location).toEqual({
      pathname: `/properties/${PROPERTY}/reviews`,
      search: { range: '30d' },
    })
  })

  it('is the old page while the router has not presented the new one', () => {
    // The router is navigating to /inbox, but the presented matches are still
    // the Overview's: the frame must stay the Overview's.
    const presented = [{ pathname: '/' }, { pathname: `/properties/${PROPERTY}` }]

    expect(renderedLocationFromMatches(presented).pathname).toBe(
      `/properties/${PROPERTY}`,
    )
  })

  it('draws nothing before the first match is presented', () => {
    expect(renderedLocationFromMatches([])).toEqual({
      pathname: '',
      search: undefined,
    })
  })
})

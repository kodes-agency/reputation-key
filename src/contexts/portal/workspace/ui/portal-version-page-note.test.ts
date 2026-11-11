import { describe, expect, it } from 'vitest'
import { STORY_VERSION_4 } from './__fixtures__/portal-history-stories-data'
import { listedTileCount, tilesLeftOutNote } from './portal-version-page-note'

describe('tilesLeftOutNote', () => {
  it('says nothing when the page draws every tile the version lists', () => {
    expect(tilesLeftOutNote({ listed: 3, drawn: 3 })).toBeNull()
  })

  it('says why the page has fewer tiles than the words', () => {
    expect(tilesLeftOutNote({ listed: 3, drawn: 2 })).toBe(
      'Tiles whose address is no longer approved are left out of the page.',
    )
  })

  it('says nothing while the listing is unknown or the Linktree is off', () => {
    expect(tilesLeftOutNote({ listed: null, drawn: 0 })).toBeNull()
  })
})

describe('listedTileCount', () => {
  it('counts the tiles the version lists', () => {
    expect(listedTileCount(STORY_VERSION_4)).toBe(2)
  })

  it('has nothing to compare while the version is not loaded or its Linktree is off', () => {
    expect(listedTileCount(null)).toBeNull()
    expect(
      listedTileCount({
        ...STORY_VERSION_4,
        content: { ...STORY_VERSION_4.content, linktreeEnabled: false },
      }),
    ).toBeNull()
  })
})

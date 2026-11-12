import { describe, expect, it } from 'vitest'
import { draftLine, laterLine } from './portal-restore-copy'

const detail = (version: number, liveVersion: number | null, newestVersion: number) => ({
  version,
  liveVersion,
  newestVersion,
  nextVersion: newestVersion + 1,
})

describe('laterLine', () => {
  it('says only the number when the draft is based on the version that is chosen', () => {
    expect(laterLine(detail(5, 4, 5))).toBe(
      'Publishing the draft later makes it version 6.',
    )
  })

  it('names what the newest version added when going back one version from it', () => {
    expect(laterLine(detail(4, 5, 5))).toBe(
      'Publishing the draft later makes it version 6 and brings back what version 5 added.',
    )
  })

  it('reasons from the newest version, not the live one, after an earlier restore', () => {
    // Live is 4 and the draft still holds 5: making 3 live, publishing the
    // draft brings back what version 5 added over 4 as well as 4's own.
    expect(laterLine(detail(3, 4, 5))).toBe(
      "Publishing the draft later makes it version 6 and brings back version 5 with the draft's changes.",
    )
  })

  it('does the same for a version further back from the newest', () => {
    expect(laterLine(detail(2, 5, 5))).toBe(
      "Publishing the draft later makes it version 6 and brings back version 5 with the draft's changes.",
    )
  })

  it('treats a move forward to a version before the newest as bringing back the newest', () => {
    expect(laterLine(detail(4, 3, 5))).toBe(
      'Publishing the draft later makes it version 6 and brings back what version 5 added.',
    )
  })
})

describe('draftLine', () => {
  it('counts the draft changes it keeps', () => {
    expect(draftLine(0)).toBe('Your draft stays as it is')
    expect(draftLine(1)).toBe('Your draft keeps its 1 change')
    expect(draftLine(3)).toBe('Your draft keeps its 3 changes')
  })
})

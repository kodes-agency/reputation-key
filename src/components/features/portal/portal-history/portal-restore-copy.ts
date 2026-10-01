// The words of the restore confirmation that depend on numbers, kept apart
// from the component so each case is a plain test.

import type { PortalVersionDetail } from '#/contexts/portal/application/public-api'

export const draftLine = (count: number): string =>
  count === 0
    ? 'Your draft stays as it is'
    : `Your draft keeps its ${count} ${count === 1 ? 'change' : 'changes'}`

/**
 * The sentence about publishing the draft later. Making a version live never
 * touches the draft, which still holds the newest version's content plus its
 * own edits, so what publishing it brings back is reasoned from the newest
 * version, not from the one guests see now.
 */
export function laterLine(
  detail: Pick<PortalVersionDetail, 'version' | 'newestVersion' | 'nextVersion'>,
): string {
  const { version, newestVersion, nextVersion } = detail
  const makes = `Publishing the draft later makes it version ${nextVersion}`
  if (version >= newestVersion) return `${makes}.`
  return version === newestVersion - 1
    ? `${makes} and brings back what version ${newestVersion} added.`
    : `${makes} and brings back version ${newestVersion} with the draft's changes.`
}

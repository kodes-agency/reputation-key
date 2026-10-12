// What the History's "View" reads for the page of a version, as story data:
// the preview fixtures drawn from each version's own details (its languages and
// tiles), with version 3 published before the new page design. A tile whose
// address is no longer approved is listed in the words and left out of the
// page, as the server does. Not imported by production code.

import type {
  PortalPreview,
  PortalPreviewOutcome,
} from '#/contexts/portal/application/public-api'
import { previewOfVersion } from '../../portal-preview/__fixtures__/portal-preview-fixtures'
import { STORY_VERSION_DETAILS } from './portal-history-stories-data'

export const STORY_EARLIER_DESIGN_VERSION = 3

/** The page of `version`: its languages, and the tiles of its words that the page still draws. */
function pageOfVersion(version: number): PortalPreview {
  const base = previewOfVersion(version)
  const detail = STORY_VERSION_DETAILS[version]
  const english = base.experiences.en
  if (detail === undefined || english === undefined) return base
  const listed = new Set(detail.content.links.map((link) => link.label))
  // The base page's tiles, by position: the ones the version lists stay.
  const drawnAt = english.links.flatMap((link, index) =>
    listed.has(link.label) ? [index] : [],
  )
  return {
    ...base,
    primaryLocale: detail.content.primaryLanguage,
    locales: detail.content.languages,
    experiences: Object.fromEntries(
      detail.content.languages.map((locale) => {
        const experience = base.experiences[locale] ?? english
        return [
          locale,
          {
            ...experience,
            links: drawnAt.flatMap((index) => {
              const link = experience.links[index]
              return link === undefined ? [] : [link]
            }),
          },
        ]
      }),
    ),
  }
}

export function storyVersionPreview(version: number): PortalPreviewOutcome {
  return version === STORY_EARLIER_DESIGN_VERSION
    ? { status: 'unavailable', source: 'version', reason: 'earlier_design' }
    : { status: 'ready', preview: pageOfVersion(version) }
}

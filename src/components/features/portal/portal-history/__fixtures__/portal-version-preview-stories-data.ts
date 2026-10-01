// What the History's "View" reads for the page of a version, as story data:
// the preview fixtures under each version's number, with version 3 published
// before the new page design. Not imported by production code.

import type { PortalPreviewOutcome } from '#/contexts/portal/application/public-api'
import { previewOfVersion } from '../../portal-preview/__fixtures__/portal-preview-fixtures'

export const STORY_EARLIER_DESIGN_VERSION = 3

export function storyVersionPreview(version: number): PortalPreviewOutcome {
  return version === STORY_EARLIER_DESIGN_VERSION
    ? { status: 'unavailable', source: 'version', reason: 'earlier_design' }
    : { status: 'ready', preview: previewOfVersion(version) }
}

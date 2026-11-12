import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { pendingSectionReads, isResourceExpected } from './portal-editor-section-reads'
import { PortalEditorSectionPanel } from './portal-editor-section-panel'
import type { PortalEditorRead, PortalEditorResources } from './portal-editor-types'

const loading: PortalEditorRead = {
  isError: false,
  isFetching: true,
  errorUpdateCount: 0,
  data: undefined,
  refetch: () => Promise.resolve({} as never),
}
const failed: PortalEditorRead = {
  ...loading,
  isError: true,
  isFetching: false,
  errorUpdateCount: 3,
}

function resourcesWith(
  reads: PortalEditorResources['reads'],
  more: Partial<PortalEditorResources> = {},
): PortalEditorResources {
  return {
    portal: { id: 'p-1', name: 'Pool' },
    propertyId: 'prop-1',
    reads,
    ...more,
  } as unknown as PortalEditorResources
}

describe('the reads a section waits on', () => {
  it('names only the reads that have not answered', () => {
    const resources = resourcesWith(
      { responsibleManagers: loading, responsibleManagerMembers: failed },
      { responsibleManagers: { assignments: [] } as never },
    )

    expect(pendingSectionReads('responsible', resources)).toEqual([failed])
  })

  it('waits on nothing for a section that reads nothing', () => {
    const resources = resourcesWith({ portalGroups: failed })

    expect(pendingSectionReads('footer', resources)).toEqual([])
    expect(pendingSectionReads('private-note', resources)).toEqual([])
  })

  it('treats a resource handed in without a read as already there', () => {
    expect(pendingSectionReads('group', resourcesWith(undefined))).toEqual([])
  })

  it('offers a section whose read is on its way, so its address still opens it', () => {
    expect(
      isResourceExpected(resourcesWith({ portalGroups: loading }), 'portalGroups'),
    ).toBe(true)
    expect(isResourceExpected(resourcesWith(undefined), 'portalGroups')).toBe(false)
  })
})

describe('a section whose read has not answered', () => {
  const panel = (section: 'group' | 'footer', read: PortalEditorRead) =>
    renderToStaticMarkup(
      createElement(PortalEditorSectionPanel, {
        section,
        group: null,
        canEdit: true,
        resources: resourcesWith({ portalGroups: read }),
      }),
    )

  it('shows its own loading state', () => {
    expect(panel('group', loading)).toContain('Loading page settings')
  })

  it('shows its own failure with a retry, without the backend detail', () => {
    const html = panel('group', failed)

    expect(html).toContain('page settings couldn’t be loaded.')
    expect(html).toContain('Try again')
  })

  it('leaves a section that reads nothing showing while another read has failed', () => {
    expect(panel('footer', failed)).not.toContain('couldn’t be loaded')
  })
})

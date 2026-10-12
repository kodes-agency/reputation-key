import { describe, expect, it } from 'vitest'
import {
  resolveResponsibleManagerSelection,
  type ResponsibleManagerEdit,
  type ResponsibleManagerServerState,
} from './selection'

const server = (
  revision: number,
  ...selection: string[]
): ResponsibleManagerServerState => ({ selection, revision })

describe('the responsible manager selection across a server refresh', () => {
  it('adopts a refreshed server selection, and its revision, when nothing was edited', () => {
    expect(
      resolveResponsibleManagerSelection(null, server(6, 'admin-1', 'manager-1')),
    ).toEqual({
      selected: ['admin-1', 'manager-1'],
      expectedRevision: 6,
      dirty: false,
    })
  })

  it('preserves unsaved local edits across a server/query refresh', () => {
    const edit: ResponsibleManagerEdit = {
      selected: ['admin-1', 'manager-local'],
      base: server(5, 'admin-1'),
    }

    expect(
      resolveResponsibleManagerSelection(edit, server(6, 'admin-1', 'manager-remote'))
        .selected,
    ).toEqual(['admin-1', 'manager-local'])
  })

  // The lost update: the kept edit never saw `manager-remote`, so saving it ends
  // that assignment. Named with revision 6 the server accepts it; named with the
  // revision it was started from, the server's fence refuses it.
  it('saves a preserved edit with the revision it was started from, not the refreshed one', () => {
    const edit: ResponsibleManagerEdit = {
      selected: ['admin-1', 'manager-local'],
      base: server(5, 'admin-1'),
    }

    expect(
      resolveResponsibleManagerSelection(edit, server(6, 'admin-1', 'manager-remote')),
    ).toEqual({
      selected: ['admin-1', 'manager-local'],
      expectedRevision: 5,
      dirty: true,
    })
  })

  it('follows the server once an edit is undone, so the refresh it sat through shows', () => {
    const undone: ResponsibleManagerEdit = {
      selected: ['admin-1'],
      base: server(5, 'admin-1'),
    }

    expect(
      resolveResponsibleManagerSelection(undone, server(6, 'admin-1', 'manager-remote')),
    ).toEqual({
      selected: ['admin-1', 'manager-remote'],
      expectedRevision: 6,
      dirty: false,
    })
  })

  it('is clean once the server holds the edited selection, as after its own save', () => {
    const saved: ResponsibleManagerEdit = {
      selected: ['admin-1', 'manager-local'],
      base: server(5, 'admin-1'),
    }

    expect(
      resolveResponsibleManagerSelection(saved, server(6, 'admin-1', 'manager-local')),
    ).toEqual({
      selected: ['admin-1', 'manager-local'],
      expectedRevision: 6,
      dirty: false,
    })
  })
})

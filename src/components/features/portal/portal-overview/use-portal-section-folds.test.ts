import { act, createElement } from 'react'
import { expect, it } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { overviewRow } from './portal-overview-fixtures'
import { buildPortalOverview } from './portal-overview-view'
import { usePortalSectionFolds } from './use-portal-section-folds'
const root = setupHookRoot()
it('rebuilds page rows when a staff section opens and closes', async () => {
  let state: ReturnType<typeof usePortalSectionFolds>
  function Probe() {
    state = usePortalSectionFolds()
    return null
  }
  await root.render(createElement(Probe))
  const rows = [overviewRow('polly', { kind: 'personal' })]
  const page = () => buildPortalOverview(rows, {}, [], 20, undefined, [], state!.folded)
  expect(page().listed).toBe(0)
  await act(async () => state!.toggleSection(page().sections[0]!))
  expect(page().listed).toBe(1)
  await act(async () => state!.toggleSection(page().sections[0]!))
  expect(page().listed).toBe(0)
})

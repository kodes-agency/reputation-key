import { describe, expect, it } from 'vitest'
import { affectedTests } from './test-affected'

const listed = [
  '[unit] src/contexts/reporting/domain/goal-pace.test.ts',
  '[unit] src/composition.lifecycle.test.ts',
  '[integration] src/contexts/reporting/monthly-goals/goal-programs.integration.test.ts',
  'Vite: some warning the list printed',
  '',
].join('\n')

const textReaders = [
  'scripts/ci/check-layout.test.ts',
  'src/shared/architecture/fixture-paths.integration.test.ts',
  'src/components/ui/button-sources.test.ts',
  '.storybook/phone-width-recorder.test.ts',
  'src/components/ui/button.stories.tsx',
]

describe('affectedTests', () => {
  it('runs the unit files the import graph reached plus every unit text reader', () => {
    expect(affectedTests(listed, textReaders, 'unit')).toEqual([
      '.storybook/phone-width-recorder.test.ts',
      'scripts/ci/check-layout.test.ts',
      'src/components/ui/button-sources.test.ts',
      'src/composition.lifecycle.test.ts',
      'src/contexts/reporting/domain/goal-pace.test.ts',
    ])
  })

  it('runs the integration files the import graph reached plus the integration text readers', () => {
    expect(affectedTests(listed, textReaders, 'integration')).toEqual([
      'src/contexts/reporting/monthly-goals/goal-programs.integration.test.ts',
      'src/shared/architecture/fixture-paths.integration.test.ts',
    ])
  })

  it('lists a file once when the graph reached a text reader too', () => {
    const both = '[unit] scripts/ci/check-layout.test.ts\n'
    expect(affectedTests(both, ['scripts/ci/check-layout.test.ts'], 'unit')).toEqual([
      'scripts/ci/check-layout.test.ts',
    ])
  })

  it('runs only the text readers when no change reaches a test', () => {
    expect(affectedTests('', ['scripts/ci/check-layout.test.ts'], 'unit')).toEqual([
      'scripts/ci/check-layout.test.ts',
    ])
  })
})

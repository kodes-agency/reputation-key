import { describe, expect, it } from 'vitest'
import {
  assertDataCellCutoverTargetBindingMatches,
  normalizeDataCellCutoverTargetBinding,
  parseDataCellCutoverTargetBindingControl,
} from './single-us-data-cell-target-binding'

const TARGET = Object.freeze({
  projectId: 'railway-project-us-test',
  environmentId: 'railway-environment-us-test',
})

describe('single-US Data Cell Railway target binding', () => {
  it('normalizes and freezes exact opaque Railway IDs', () => {
    const target = normalizeDataCellCutoverTargetBinding({
      projectId: `  ${TARGET.projectId}  `,
      environmentId: `  ${TARGET.environmentId}  `,
    })

    expect(target).toEqual(TARGET)
    expect(Object.isFrozen(target)).toBe(true)
  })

  it.each([
    [{ projectId: '', environmentId: TARGET.environmentId }, 'Railway project ID'],
    [{ projectId: ' ', environmentId: TARGET.environmentId }, 'Railway project ID'],
    [
      { projectId: 'p'.repeat(256), environmentId: TARGET.environmentId },
      'Railway project ID',
    ],
    [{ projectId: TARGET.projectId, environmentId: '' }, 'Railway environment ID'],
    [{ projectId: TARGET.projectId, environmentId: ' ' }, 'Railway environment ID'],
    [
      { projectId: TARGET.projectId, environmentId: 'e'.repeat(256) },
      'Railway environment ID',
    ],
  ])('refuses an invalid or oversized opaque target ID', (input, label) => {
    expect(() => normalizeDataCellCutoverTargetBinding(input)).toThrow(
      `Data Cell cutover ${label} must be between 1 and 255 characters`,
    )
  })

  it.each(['open', 'fenced', 'completed'] as const)(
    'parses a fully bound %s authority',
    (state) => {
      expect(
        parseDataCellCutoverTargetBindingControl({
          state,
          target_project_id: TARGET.projectId,
          target_environment_id: TARGET.environmentId,
        }),
      ).toEqual({
        state,
        targetProjectId: TARGET.projectId,
        targetEnvironmentId: TARGET.environmentId,
      })
    },
  )

  it('permits only an open authority to remain unbound', () => {
    expect(
      parseDataCellCutoverTargetBindingControl({
        state: 'open',
        target_project_id: null,
        target_environment_id: null,
      }),
    ).toEqual({
      state: 'open',
      targetProjectId: null,
      targetEnvironmentId: null,
    })

    for (const state of ['fenced', 'completed'] as const) {
      expect(() =>
        parseDataCellCutoverTargetBindingControl({
          state,
          target_project_id: null,
          target_environment_id: null,
        }),
      ).toThrow('Data Cell topology cutover target binding is invalid')
    }
  })

  it('rejects malformed state and one-sided bindings', () => {
    expect(() =>
      parseDataCellCutoverTargetBindingControl({
        state: 'surprise',
        target_project_id: TARGET.projectId,
        target_environment_id: TARGET.environmentId,
      }),
    ).toThrow('Data Cell topology cutover authority is unavailable')

    for (const row of [
      {
        state: 'open',
        target_project_id: TARGET.projectId,
        target_environment_id: null,
      },
      {
        state: 'open',
        target_project_id: null,
        target_environment_id: TARGET.environmentId,
      },
    ]) {
      expect(() => parseDataCellCutoverTargetBindingControl(row)).toThrow(
        'Data Cell topology cutover target binding is invalid',
      )
    }
  })

  it('accepts an unbound or exact target and refuses either target mismatch', () => {
    expect(() =>
      assertDataCellCutoverTargetBindingMatches(
        { state: 'open', targetProjectId: null, targetEnvironmentId: null },
        TARGET,
      ),
    ).not.toThrow()
    expect(() =>
      assertDataCellCutoverTargetBindingMatches(
        {
          state: 'completed',
          targetProjectId: TARGET.projectId,
          targetEnvironmentId: TARGET.environmentId,
        },
        TARGET,
      ),
    ).not.toThrow()

    for (const control of [
      {
        state: 'open' as const,
        targetProjectId: 'another-project',
        targetEnvironmentId: TARGET.environmentId,
      },
      {
        state: 'open' as const,
        targetProjectId: TARGET.projectId,
        targetEnvironmentId: 'another-environment',
      },
    ]) {
      expect(() => assertDataCellCutoverTargetBindingMatches(control, TARGET)).toThrow(
        'Data Cell cutover Railway target does not match its binding',
      )
    }
  })
})

// Turning a TanStack Form into one autosave write. The adapter has three jobs
// the form itself does not do: skip a write when nothing differs from what the
// server already holds, tell "invalid" apart from "saved" (handleSubmit resolves
// either way), and remember what it wrote so the next comparison is honest.

import { describe, expect, it, vi } from 'vitest'
import { createDraftFormSaveTracker, saveDraftForm } from './portal-draft-form-save'

type FakeForm = {
  state: { values: unknown; isValid: boolean }
  handleSubmit: ReturnType<typeof vi.fn<() => Promise<void>>>
}

function fakeForm(
  values: unknown,
  submit: () => Promise<void> = async () => undefined,
  isValid = true,
): FakeForm {
  return { state: { values, isValid }, handleSubmit: vi.fn(submit) }
}

describe('saveDraftForm', () => {
  it('submits the form and reports "saved" when the values are new', async () => {
    const form = fakeForm({ name: 'Pool' })
    const tracker = createDraftFormSaveTracker({ name: 'Pool & Terrace' })

    await expect(saveDraftForm(form, tracker)).resolves.toBe('saved')
    expect(form.handleSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not submit when the values equal what the server already holds', async () => {
    const form = fakeForm({ name: 'Pool', slug: 'pool' })
    const tracker = createDraftFormSaveTracker({ name: 'Pool', slug: 'pool' })

    await expect(saveDraftForm(form, tracker)).resolves.toBe('saved')
    expect(form.handleSubmit).not.toHaveBeenCalled()
  })

  it('compares values, not key order', async () => {
    const form = fakeForm({ slug: 'pool', name: 'Pool' })
    const tracker = createDraftFormSaveTracker({ name: 'Pool', slug: 'pool' })

    await saveDraftForm(form, tracker)

    expect(form.handleSubmit).not.toHaveBeenCalled()
  })

  it('reports "invalid" when the form refused the values, and keeps the old baseline', async () => {
    const form = fakeForm({ name: '' }, async () => undefined, false)
    const tracker = createDraftFormSaveTracker({ name: 'Pool' })

    await expect(saveDraftForm(form, tracker)).resolves.toBe('invalid')

    form.state.values = { name: 'Pool' }
    form.state.isValid = true
    await saveDraftForm(form, tracker)
    expect(form.handleSubmit).toHaveBeenCalledTimes(1)
  })

  it('remembers what it wrote, so the same values are not written twice', async () => {
    const form = fakeForm({ name: 'Pool 2' })
    const tracker = createDraftFormSaveTracker({ name: 'Pool' })

    await saveDraftForm(form, tracker)
    await saveDraftForm(form, tracker)

    expect(form.handleSubmit).toHaveBeenCalledTimes(1)
  })

  it('records the values that were submitted, not values typed while the write ran', async () => {
    const form = fakeForm({ name: 'Pool 2' }, async () => {
      form.state.values = { name: 'Pool 23' }
    })
    const tracker = createDraftFormSaveTracker({ name: 'Pool' })

    await saveDraftForm(form, tracker)
    await saveDraftForm(form, tracker)

    expect(form.handleSubmit).toHaveBeenCalledTimes(2)
  })

  it('lets a rejected submit reach the coordinator and does not move the baseline', async () => {
    const form = fakeForm({ name: 'Pool 2' }, async () => {
      throw new Error('offline')
    })
    const tracker = createDraftFormSaveTracker({ name: 'Pool' })

    await expect(saveDraftForm(form, tracker)).rejects.toThrow('offline')

    form.handleSubmit = vi.fn(async () => undefined)
    await saveDraftForm(form, tracker)
    expect(form.handleSubmit).toHaveBeenCalledTimes(1)
  })
})

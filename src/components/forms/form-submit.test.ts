// The one wiring of a form's `onSubmit` (UI consistency scan: FORM-18).
import type { FormEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { submitForm, submitHandler } from './form-submit'

function submitEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as FormEvent<HTMLFormElement> & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  }
}

describe('submitForm', () => {
  it('runs the form and resolves when it submits', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined)

    await expect(submitForm({ handleSubmit })).resolves.toBeUndefined()

    expect(handleSubmit).toHaveBeenCalledTimes(1)
  })

  it('consumes the rejection the action already keeps for the banner', async () => {
    const handleSubmit = vi.fn().mockRejectedValue(new Error('refused'))

    await expect(submitForm({ handleSubmit })).resolves.toBeUndefined()
  })
})

describe('submitHandler', () => {
  it('stops the native submit and the event reaching an outer form', () => {
    const event = submitEvent()

    submitHandler({ handleSubmit: vi.fn().mockResolvedValue(undefined) })(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('submits the form once per event', () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined)

    submitHandler({ handleSubmit })(submitEvent())

    expect(handleSubmit).toHaveBeenCalledTimes(1)
  })

  it('leaves no unhandled rejection when the action refuses', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      submitHandler({ handleSubmit: vi.fn().mockRejectedValue(new Error('refused')) })(
        submitEvent(),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off('unhandledRejection', unhandled)
    }

    expect(unhandled).not.toHaveBeenCalled()
  })
})

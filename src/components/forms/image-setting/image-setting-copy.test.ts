// The words an identity image is set in (UI consistency scan: FORM-14). The formats and
// the size limit are printed from the same values the file is checked against, so the
// help under the buttons can never promise what the check refuses.
import { describe, expect, it } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  acceptedFormatsText,
  imageSettingLabels,
  imageSettingHelp,
  invalidFileMessage,
  removeFailureMessage,
  uploadFailureMessage,
} from './image-setting-copy'

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MB = 1024 * 1024

describe('acceptedFormatsText', () => {
  it('names each format the way a person writes it', () => {
    expect(acceptedFormatsText(TYPES)).toBe('JPG, PNG, WebP or GIF')
  })

  it('reads a single format without a conjunction', () => {
    expect(acceptedFormatsText(['image/png'])).toBe('PNG')
  })

  it('upper-cases a format it has no name for', () => {
    expect(acceptedFormatsText(['image/avif', 'image/png'])).toBe('AVIF or PNG')
  })
})

describe('imageSettingHelp', () => {
  it('states the formats and the size limit the file is checked against', () => {
    expect(imageSettingHelp(TYPES, 5 * MB)).toBe('JPG, PNG, WebP or GIF, up to 5 MB.')
  })

  it('prints a limit that is not a whole number of megabytes', () => {
    expect(imageSettingHelp(['image/png'], 2.5 * MB)).toBe('PNG, up to 2.5 MB.')
  })
})

describe('imageSettingLabels', () => {
  it('names the action for what the image is, so two settings on one page differ', () => {
    expect(imageSettingLabels('logo')).toEqual({
      upload: 'Upload logo',
      replace: 'Replace logo',
      remove: 'Remove logo',
      uploading: 'Uploading…',
      removing: 'Removing…',
      current: 'Current logo',
      none: 'No logo yet',
    })
  })
})

describe('invalidFileMessage', () => {
  it('asks for one of the accepted formats when the type is refused', () => {
    expect(invalidFileMessage({ type: 'application/pdf', size: 10 }, TYPES, 5 * MB)).toBe(
      'Choose a JPG, PNG, WebP or GIF image.',
    )
  })

  it('asks for a smaller file when the size is refused', () => {
    expect(invalidFileMessage({ type: 'image/png', size: 6 * MB }, TYPES, 5 * MB)).toBe(
      'Choose an image under 5 MB.',
    )
  })

  it('accepts a file of an accepted type within the limit', () => {
    expect(invalidFileMessage({ type: 'image/png', size: 5 * MB }, TYPES, 5 * MB)).toBe(
      null,
    )
  })
})

describe('failure messages', () => {
  it('never echoes the text of a network or storage failure', () => {
    expect(uploadFailureMessage('logo')(new Error('Upload failed: 403'))).toBe(
      "Couldn't upload that logo. Try again.",
    )
    expect(removeFailureMessage('avatar')(new Error('boom'))).toBe(
      "Couldn't remove that avatar. Try again.",
    )
  })

  it('keeps the sentence the server wrote for a refusal', () => {
    const refusal = new ServerFunctionError(
      'IdentityError',
      'Images must be smaller than 5 MB.',
      'invalid_input',
      422,
    )

    expect(uploadFailureMessage('logo')(refusal)).toBe(
      'Images must be smaller than 5 MB.',
    )
    expect(removeFailureMessage('logo')(refusal)).toBe(
      'Images must be smaller than 5 MB.',
    )
  })
})

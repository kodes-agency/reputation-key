// An upload from the image field is an immediate action, so it reports like
// every other one: the server's sentence for a refusal it wrote for the person,
// and otherwise a sentence of our own. It used to toast `err.message`, which is
// whatever the storage layer or the network stack said.
import { describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { uploadFailureMessage } from './use-file-upload'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: vi.fn() }),
  createSerializationAdapter: (adapter: unknown) => adapter,
}))

describe('uploadFailureMessage', () => {
  it('never echoes the text of a network or storage failure', () => {
    expect(uploadFailureMessage(new Error('Upload failed: 403'))).toBe(
      "Couldn't upload that image. Try again.",
    )
    expect(uploadFailureMessage(new Error('Network error'))).toBe(
      "Couldn't upload that image. Try again.",
    )
  })

  it('never echoes the text of a server failure', () => {
    const failure = new ServerFunctionError(
      'InternalError',
      'S3 PutObject AccessDenied for bucket repkey-prod',
      'internal_error',
      500,
    )

    expect(uploadFailureMessage(failure)).toBe("Couldn't upload that image. Try again.")
  })

  it('keeps the sentence the server wrote for a refusal', () => {
    const refusal = new ServerFunctionError(
      'IdentityError',
      'Images must be smaller than 5 MB.',
      'invalid_input',
      422,
    )

    expect(uploadFailureMessage(refusal)).toBe('Images must be smaller than 5 MB.')
  })
})

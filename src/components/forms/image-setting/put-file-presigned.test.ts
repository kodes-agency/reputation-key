import { describe, expect, it } from 'vitest'
import { buildPresignedUploadHeaders } from './put-file-presigned'

describe('buildPresignedUploadHeaders', () => {
  it('carries the storage-signed first-write condition to the browser PUT', () => {
    expect(
      buildPresignedUploadHeaders({ type: 'image/png' }, { 'If-None-Match': '*' }),
    ).toEqual({
      'Content-Type': 'image/png',
      'If-None-Match': '*',
    })
  })

  it('rejects a required header that conflicts with the selected file MIME', () => {
    expect(() =>
      buildPresignedUploadHeaders(
        { type: 'image/png' },
        { 'content-type': 'image/jpeg' },
      ),
    ).toThrow('conflicts')
  })
})

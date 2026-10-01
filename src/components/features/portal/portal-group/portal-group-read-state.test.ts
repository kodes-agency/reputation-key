import { describe, expect, it } from 'vitest'
import { readStateOf } from './portal-group-read-state'

const denial = Object.assign(new Error('off'), { code: 'org_not_allowlisted' })

describe('readStateOf', () => {
  it('shows nothing where the reader may not read it', () => {
    expect(readStateOf({ allowed: false, error: null, data: undefined })).toEqual({
      status: 'off',
    })
  })

  it('gives the data once it is here, even while a newer read is on its way', () => {
    expect(readStateOf({ allowed: true, error: null, data: [1] })).toEqual({
      status: 'ready',
      data: [1],
    })
  })

  it('waits while the read is on its way', () => {
    expect(readStateOf({ allowed: true, error: null, data: undefined })).toEqual({
      status: 'loading',
    })
  })

  it('treats a capability that is deliberately off as nothing to show, not a failure', () => {
    expect(readStateOf({ allowed: true, error: denial, data: undefined })).toEqual({
      status: 'off',
    })
  })

  it('says a real failure is one, so the page can offer to try again', () => {
    expect(
      readStateOf({ allowed: true, error: new Error('db down'), data: undefined }),
    ).toEqual({
      status: 'failed',
    })
  })

  it('keeps data it already has over an error from a refetch', () => {
    expect(readStateOf({ allowed: true, error: new Error('x'), data: ['kept'] })).toEqual(
      {
        status: 'ready',
        data: ['kept'],
      },
    )
  })
})

// Fields that are written when they are left, not while they are typed (the
// URL slug). Whatever else writes the form meanwhile must send the value the
// person last committed, never a half-typed one.

import { describe, expect, it } from 'vitest'
import { createBlurCommittedFields } from './portal-draft-blur-fields'

const make = () => createBlurCommittedFields(['slug'], { name: 'Pool', slug: 'pool' })

describe('createBlurCommittedFields', () => {
  it('sends the committed value of a blur-committed field, whatever is typed in it', () => {
    const fields = make()
    fields.type('slug', 'po')

    expect(fields.apply({ name: 'Pool 2', slug: 'po' })).toEqual({
      name: 'Pool 2',
      slug: 'pool',
    })
  })

  it('sends the new value once the field has been left', () => {
    const fields = make()
    fields.type('slug', 'pool-bar')
    fields.commit('slug', 'pool-bar')

    expect(fields.apply({ name: 'Pool', slug: 'pool-bar' })).toEqual({
      name: 'Pool',
      slug: 'pool-bar',
    })
  })

  it('leaves the other fields exactly as they are', () => {
    expect(make().apply({ name: 'Anything', slug: 'x' }).name).toBe('Anything')
  })

  it('does not change the object it was given', () => {
    const values = { name: 'Pool', slug: 'po' }
    make().apply(values)
    expect(values.slug).toBe('po')
  })

  it('has nothing uncommitted until a blur-committed field differs from its commit', () => {
    const fields = make()
    expect(fields.hasUncommitted()).toBe(false)

    fields.type('slug', 'po')
    expect(fields.hasUncommitted()).toBe(true)

    fields.type('slug', 'pool')
    expect(fields.hasUncommitted()).toBe(false)
  })

  it('is clean again once the typed value is committed', () => {
    const fields = make()
    fields.type('slug', 'pool-bar')
    fields.commit('slug', 'pool-bar')

    expect(fields.hasUncommitted()).toBe(false)
  })

  it('ignores fields that are not blur-committed', () => {
    const fields = make()
    fields.type('name', 'Pool 2')
    fields.commit('name', 'Pool 2')

    expect(fields.hasUncommitted()).toBe(false)
    expect(fields.apply({ name: 'Pool 3', slug: 'pool' }).name).toBe('Pool 3')
  })
})

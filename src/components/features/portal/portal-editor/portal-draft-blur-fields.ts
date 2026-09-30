// Fields that are written when they are left, not while they are typed.
//
// The URL slug is the case: a half-typed address would otherwise be saved, and
// a saved slug unlinks every hand-typed URL that spells the old one. Holding
// back the keystroke's own write is not enough, because every write of the form
// sends the whole form. So the form writes the field's COMMITTED value (the
// last one it was left with) and the typed value only replaces it on blur.

export type BlurCommittedFields = Readonly<{
  /** The field's typed value changed. */
  type: (name: string, value: unknown) => void
  /** The field was left with this value: from now on it is the one written. */
  commit: (name: string, value: unknown) => void
  /** The form's values with each blur-committed field at its committed value. */
  apply: <T extends object>(values: T) => T
  /** A blur-committed field holds something that has not been committed. */
  hasUncommitted: () => boolean
}>

export function createBlurCommittedFields(
  names: ReadonlyArray<string>,
  initialValues: Readonly<Record<string, unknown>>,
): BlurCommittedFields {
  const pick = (source: Readonly<Record<string, unknown>>) =>
    Object.fromEntries(names.map((name) => [name, source[name]]))
  let committed: Readonly<Record<string, unknown>> = pick(initialValues)
  let typed: Readonly<Record<string, unknown>> = committed

  return {
    type(name, value) {
      if (names.includes(name)) typed = { ...typed, [name]: value }
    },
    commit(name, value) {
      if (!names.includes(name)) return
      typed = { ...typed, [name]: value }
      committed = { ...committed, [name]: value }
    },
    apply: (values) => ({ ...values, ...committed }),
    hasUncommitted: () => names.some((name) => typed[name] !== committed[name]),
  }
}

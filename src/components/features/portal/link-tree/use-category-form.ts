// Portal context — title state and submit gate shared by the category forms.

import { useState, type FormEvent } from 'react'

type Options = Readonly<{
  /** Edit mode seeds the current title; add mode starts empty. */
  initialTitle: string
  onSubmit: (title: string) => Promise<void> | void
  /**
   * The add form stays mounted after a successful create and clears itself for
   * the next entry; the edit form unmounts, so it must keep what it has.
   */
  clearOnSuccess: boolean
  isPending?: boolean
}>

export function useCategoryForm({
  initialTitle,
  onSubmit,
  clearOnSuccess,
  isPending,
}: Options) {
  const [title, setTitle] = useState(initialTitle)

  /**
   * A rejection is swallowed on purpose: the shared mutation object already
   * holds the failure and the caller renders it as the inline error line, so
   * rethrowing here would only surface as an `unhandledrejection`. Clearing runs
   * in `then` so a failed create keeps the typed title for a retry.
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    void Promise.resolve(onSubmit(trimmed))
      .then(() => (clearOnSuccess ? setTitle('') : undefined))
      .catch(() => undefined)
  }

  return {
    title,
    setTitle,
    handleSubmit,
    /** Blank titles are rejected by the use case, and a pending submit locks. */
    canSubmit: title.trim() !== '' && isPending !== true,
  }
}

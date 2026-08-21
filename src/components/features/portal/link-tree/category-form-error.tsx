// Portal context — inline error line shared by the category title forms.

import { categoryFormErrorMessage } from './category-form-rules'

type Props = Readonly<{
  error?: unknown
  /** Used when the failure carries no message of its own. */
  fallback: string
}>

export function CategoryFormError({ error, fallback }: Props) {
  const message = categoryFormErrorMessage(error, fallback)
  if (message === null) return null

  return <p className="text-sm text-destructive">{message}</p>
}

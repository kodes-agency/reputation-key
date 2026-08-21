// Portal context — pure rules shared by the category title forms.

/**
 * Message for a category form's inline error line, or `null` to render nothing.
 *
 * Precedence: a thrown `Error` always speaks for itself, because the create and
 * update use cases reject with the user-facing reason (a duplicate title, a lost
 * permission) and seroval preserves that `.message` across the server boundary.
 * `fallback` covers only the shapes that carry no message of their own.
 */
export function categoryFormErrorMessage(
  error: unknown,
  fallback: string,
): string | null {
  if (error == null) return null
  if (error instanceof Error) return error.message
  return fallback
}

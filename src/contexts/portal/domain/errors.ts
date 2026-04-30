// Portal context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

export type PortalErrorCode =
  | 'forbidden'
  | 'invalid_slug'
  | 'invalid_name'
  | 'invalid_description'
  | 'invalid_theme'
  | 'invalid_threshold'
  | 'invalid_url'
  | 'invalid_label'
  | 'invalid_title'
  | 'slug_taken'
  | 'portal_not_found'
  | 'category_not_found'
  | 'link_not_found'
  | 'property_not_found'
  | 'upload_failed'

export type PortalError = Readonly<{
  _tag: 'PortalError'
  code: PortalErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a PortalError. */
export const portalError = (
  code: PortalErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): PortalError => ({
  _tag: 'PortalError',
  code,
  message,
  ...(context ? { context } : {}),
})

/** Type guard — lets server functions detect PortalError at catch time. */
export const isPortalError = (e: unknown): e is PortalError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'PortalError'

import { createErrorFactory } from '#/shared/domain/errors'

export type OrganizationLifecycleJobErrorCode =
  | 'scheduled_pass_failed'
  | 'context_contribution_failed'
  | 'export_generation_failed'
  | 'export_deletion_failed'

export type OrganizationLifecycleJobError = Error &
  Readonly<{
    _tag: 'OrganizationLifecycleJobError'
    code: OrganizationLifecycleJobErrorCode
  }>

const createOrganizationLifecycleJobError = createErrorFactory<
  OrganizationLifecycleJobError['_tag'],
  OrganizationLifecycleJobError['code']
>('OrganizationLifecycleJobError')

/** Fixed, content-free messages are safe for traces and failure quarantine. */
export function organizationLifecycleJobError(
  code: OrganizationLifecycleJobErrorCode,
): OrganizationLifecycleJobError {
  const message = {
    scheduled_pass_failed: 'Organization lifecycle maintenance could not complete',
    context_contribution_failed:
      'Organization lifecycle maintenance has unresolved context contributions',
    export_generation_failed: 'Organization Export generation could not complete',
    export_deletion_failed: 'Organization Export deletion could not complete',
  }[code]
  return createOrganizationLifecycleJobError(code, message)
}

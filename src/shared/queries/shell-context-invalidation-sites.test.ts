// Every change that alters what the shell shows or decides from forgets its
// remembered checks (ADR 0072). The shell keeps the session, the Organization and the
// role for 30 seconds, so a site that forgets to forget leaves the person looking at
// the old name, or opening pages with the old role, until the entry ages out.
//
// The profile save and the Organization update are tested by behaviour
// (`settings/-profile.test.ts`, `organization-cache-policy.test.ts`), sign-in and
// sign-out by `tenant-cache-transition.test.ts`. The rest are mutations inside large
// route components, so this holds each one to the call by reading its source.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/**
 * The `useActionMutation` call on `fn` in `source`, up to the next one: the options
 * it is given and nothing another mutation is given.
 */
function mutationOptions(source: string, fn: string): string {
  const call = new RegExp(`useActionMutation(<[^>]*>)?\\(\\s*${fn}\\b`).exec(source)
  if (!call) throw new Error(`no useActionMutation(${fn}) in the source`)
  const next = source.indexOf('useActionMutation', call.index + call[0].length)
  return source.slice(call.index, next === -1 ? undefined : next)
}

const SITES = [
  // An admin may change or remove their own membership among other admins.
  ['src/routes/_authenticated/settings/members.tsx', 'updateMemberRole'],
  ['src/routes/_authenticated/settings/members.tsx', 'removeMember'],
  // The member may be the reader, whose Property access the shell holds.
  ['src/routes/_authenticated/settings/-member-access-container.tsx', 'saveMemberAccess'],
  // The session the shell remembered ended.
  [
    'src/routes/_authenticated/settings/-leave-organization-section.tsx',
    'leaveOrganizationFn',
  ],
  // The password change replaces the session and sets its Organization again.
  ['src/routes/_authenticated/settings/security.tsx', 'changePasswordFn'],
] as const

describe('sites that forget the shell checks', () => {
  it.each(SITES)('%s: the %s mutation forgets them on success', (path, fn) => {
    expect(mutationOptions(read(path), fn)).toMatch(
      /invalidateShellContext\(queryClient\)/,
    )
  })

  it('a refusal at a route boundary forgets them', () => {
    expect(read('src/components/layout/use-guarded-route-error.tsx')).toMatch(
      /if \(refused\) invalidateShellContext\(queryClient\)/,
    )
  })

  it('the browser router forgets them when the tab comes back', () => {
    expect(read('src/router.tsx')).toMatch(/forgetShellContextOnReturn\(queryClient,/)
  })
})

import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKSPACE = resolve('.')
const FORM_ROOT = /<form(?:\s|>)/

const assignedRoots = ['src/components/features/guest', 'src/components/inbox'] as const
const assignedFiles = [
  'src/components/features/settings/notifications-settings-view.tsx',
  'src/components/features/settings/notification-formatting-form.tsx',
] as const

function productionTsxFiles(root: string): string[] {
  return readdirSync(resolve(WORKSPACE, root), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${root}/${entry.name}`
      if (entry.isDirectory()) return productionTsxFiles(path)
      if (
        !entry.isFile() ||
        !path.endsWith('.tsx') ||
        /\.(?:test|stories)\.tsx$/.test(path)
      ) {
        return []
      }
      return [path]
    },
  )
}

function violationsFor(source: string): string[] {
  if (!FORM_ROOT.test(source)) return []
  const violations: string[] = []
  if (!source.includes("from '@tanstack/react-form'")) {
    violations.push('missing TanStack Form')
  }
  if (!source.includes('validators: { onSubmit:')) {
    violations.push('missing submit-time schema validation')
  }
  if (!/\/application\/dto\//.test(source)) {
    violations.push('missing application DTO schema')
  }
  if (/from ['"](?:zod|zod\/v4)['"]/.test(source)) {
    violations.push('component-local Zod authority')
  }
  if (/\buseState\s*\(/.test(source)) {
    violations.push('manual useState form data')
  }
  return violations
}

describe('Guest, Inbox, and notification journey-form standards', () => {
  it('keeps every production form root on TanStack Form and an application DTO', () => {
    const files = [...assignedRoots.flatMap(productionTsxFiles), ...assignedFiles]
    const formFiles = files
      .filter((path) => FORM_ROOT.test(readFileSync(resolve(WORKSPACE, path), 'utf8')))
      .sort()

    expect(formFiles).toEqual([
      'src/components/features/guest/public-portal/guest-private-feedback-form.tsx',
      'src/components/features/guest/public-portal/guest-rating-form.tsx',
      'src/components/features/settings/notification-formatting-form.tsx',
      'src/components/inbox/feedback-handling-form.tsx',
      'src/components/inbox/inbox-notes-thread.tsx',
    ])

    const violations = formFiles.flatMap((path) =>
      violationsFor(readFileSync(resolve(WORKSPACE, path), 'utf8')).map(
        (violation) => `${relative(WORKSPACE, path)}: ${violation}`,
      ),
    )
    expect(violations).toEqual([])
  })

  it('proves the guard rejects a raw state-backed form with local validation', () => {
    const rawForm = `
      import { useState } from 'react'
      import { z } from 'zod/v4'
      const schema = z.object({ text: z.string() })
      export function RawForm() {
        const [text, setText] = useState('')
        return <form onSubmit={() => schema.parse({ text })} />
      }
    `
    expect(violationsFor(rawForm)).toEqual([
      'missing TanStack Form',
      'missing submit-time schema validation',
      'missing application DTO schema',
      'component-local Zod authority',
      'manual useState form data',
    ])
  })
})

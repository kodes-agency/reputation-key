import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKSPACE = resolve('.')
const PORTAL_ROOT = 'src/components/features/portal'
const FORM_ROOT = /<form(?:\s|>)/

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

function formViolations(source: string): string[] {
  if (!FORM_ROOT.test(source)) return []
  const violations: string[] = []
  if (!source.includes("from '@tanstack/react-form'")) {
    violations.push('missing TanStack Form')
  }
  if (!/validators:\s*{\s*onSubmit:/.test(source)) {
    violations.push('missing submit-time schema validation')
  }
  if (!/\/application\/dto\//.test(source)) {
    violations.push('missing Portal application DTO schema')
  }
  if (/\bz\.object\s*\(/.test(source)) {
    violations.push('component-local Zod object authority')
  }
  if (/\buseState\s*\(/.test(source)) {
    violations.push('manual useState form data')
  }
  if (source.trimEnd().split(/\r?\n/).length > 150) {
    violations.push('form root exceeds the 150-line component limit')
  }
  return violations
}

const movedServerSchemaNames = [
  'propertyPortalExperienceSchema',
  'propertyPortalBrandProfileSchema',
  'propertyPortalBrandContentSchema',
  'portalLocalizedOverrideSchema',
  'portalApprovedDestinationRequestSchema',
  'issuePortalTokenSchema',
  'rotatePortalTokenSchema',
  'revokePortalTokensSchema',
] as const

describe('Portal form and command DTO architecture standards', () => {
  it('keeps an exhaustive inventory of Portal form roots on TanStack Form and DTOs', () => {
    const formFiles = productionTsxFiles(PORTAL_ROOT)
      .filter((path) => FORM_ROOT.test(readFileSync(resolve(WORKSPACE, path), 'utf8')))
      .sort()

    expect(formFiles).toEqual([
      'src/components/features/portal/link-tree/category-add-form.tsx',
      'src/components/features/portal/link-tree/category-edit-inline-form.tsx',
      'src/components/features/portal/link-tree/link-inline-form.tsx',
      'src/components/features/portal/portal-form/create-portal-form.tsx',
      'src/components/features/portal/portal-form/edit-portal-form.tsx',
      'src/components/features/portal/portal-group-create-form.tsx',
      'src/components/features/portal/portal-group-rename-form.tsx',
      'src/components/features/portal/portal-settings/portal-approved-destination-request-form.tsx',
      'src/components/features/portal/portal-settings/portal-localized-override-form.tsx',
      'src/components/features/portal/portal-settings/portal-property-brand-editor.tsx',
      'src/components/features/portal/portal-settings/portal-property-content-form.tsx',
      'src/components/features/portal/portal-share/portal-planned-replacement-form.tsx',
      'src/components/features/portal/portal-share/portal-revoke-links-form.tsx',
    ])

    const violations = formFiles.flatMap((path) =>
      formViolations(readFileSync(resolve(WORKSPACE, path), 'utf8')).map(
        (violation) => `${relative(WORKSPACE, path)}: ${violation}`,
      ),
    )
    expect(violations).toEqual([])
  })

  it('keeps UI-consumed command validators out of the Portal server adapter', () => {
    const server = readFileSync(
      resolve(WORKSPACE, 'src/contexts/portal/server/portals.ts'),
      'utf8',
    )
    for (const schemaName of movedServerSchemaNames) {
      expect(server).not.toContain(`const ${schemaName}`)
    }
    expect(server).toContain("from '../application/dto/portal-experience.dto'")
    expect(server).toContain("from '../application/dto/portal-token-lifecycle.dto'")
  })

  it('proves the form guard rejects raw state and a locally-owned schema', () => {
    const rawForm = `
      import { useState } from 'react'
      import { z } from 'zod/v4'
      const schema = z.object({ name: z.string() })
      export function RawPortalForm() {
        const [name, setName] = useState('')
        return <form onSubmit={() => schema.parse({ name })} />
      }
    `
    expect(formViolations(rawForm)).toEqual([
      'missing TanStack Form',
      'missing submit-time schema validation',
      'missing Portal application DTO schema',
      'component-local Zod object authority',
      'manual useState form data',
    ])
  })
})

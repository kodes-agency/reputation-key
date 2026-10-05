// One way to set an identity image (UI consistency scan: FORM-14).
//
// An avatar and an organization logo were the same hover-to-replace circle in two
// frames, with an icon-only corner button for Remove and, for the avatar, a Remove
// that only cleared the page. The Property look logo is a different task (it crops,
// sets a focal point and checks a light version) and keeps its dialog. These checks
// read the sources, so a second image field for an avatar or a logo fails here with the
// file named instead of drifting back.

import { describe, expect, it } from 'vitest'
import { readUiSources } from '#/shared/testing/source-tree'

const FILES = readUiSources({ includeTs: true })

type SourceFile = (typeof FILES)[number]

const pathsOf = (matches: (file: SourceFile) => boolean) =>
  FILES.filter(matches).map((file) => file.path)

describe('an avatar and a logo are an ImageSetting', () => {
  it('has no second image field: the hover-to-replace circle is gone', () => {
    expect(
      pathsOf((file) => /ImageUploadField|image-upload-field/u.test(file.text)),
    ).toEqual([])
  })

  it('is what the avatar card and the organization logo draw', () => {
    expect(pathsOf((file) => /<ImageSetting\b/u.test(file.text)).sort()).toEqual([
      'src/components/features/identity/avatar-card.tsx',
      'src/components/features/organization/organization-settings-page.tsx',
    ])
  })

  it('names Replace and Remove as words: no hover-only Replace over a picture', () => {
    const hoverOnly = (file: SourceFile) =>
      /group-hover:opacity-100[^"]*"[^>]*>\s*Replace\b/u.test(file.text)

    expect(pathsOf(hoverOnly)).toEqual([])
  })
})

describe('a removal is saved, not only drawn', () => {
  it('reaches the server for the avatar: the page forwards a removal call, not a local state', () => {
    const profile = FILES.find(
      (file) =>
        file.path === 'src/components/features/identity/profile-settings-form.tsx',
    )

    expect(profile?.text).toMatch(/removeUserImage\(\{\s*data:\s*\{\s*imageUrl:\s*null/u)
    expect(profile?.text).not.toMatch(/useState\b/u)
  })

  it('reaches the server for the logo', () => {
    const organization = FILES.find(
      (file) =>
        file.path ===
        'src/components/features/organization/organization-settings-page.tsx',
    )

    expect(organization?.text).toMatch(
      /removeOrganizationLogo\(\{\s*data:\s*\{\s*logo:\s*null/u,
    )
  })
})

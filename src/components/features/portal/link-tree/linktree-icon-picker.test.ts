// Rendered to markup and read back: the unit project has no DOM. The dialog the
// upload tile opens, and the pointer and keyboard flow, run in the stories.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '#/components/ui/tooltip'
import { LinktreeIconPicker } from './linktree-icon-picker'

const PHOTO = '/api/public/portal-media/30000000-0000-4000-8000-000000000001'

const render = (props: Partial<Parameters<typeof LinktreeIconPicker>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(LinktreeIconPicker, {
        value: 'utensils',
        photoUrl: null,
        isPhotoChosen: false,
        onChoosePhoto: () => undefined,
        onChange: () => undefined,
        onUploadPhoto: () => undefined,
        ...props,
      }),
    ),
  )

/** The opening tag of the element carrying `aria-label="<name>"`. */
const tagNamed = (html: string, name: string): string => {
  const at = html.indexOf(`aria-label="${name}"`)
  expect(at, `no element named ${name}`).toBeGreaterThan(-1)
  const open = html.lastIndexOf('<', at)
  return html.slice(open, html.indexOf('>', at) + 1)
}

describe('LinktreeIconPicker', () => {
  it('is named for both choices, because a tile wears an icon or a photo', () => {
    expect(render()).toContain('aria-label="Icon or photo"')
  })

  it('ends with a dashed button that uploads a photo instead of an icon', () => {
    const tag = tagNamed(render(), 'Upload a photo instead of an icon')

    expect(tag).toContain('<button')
    expect(tag).toContain('type="button"')
    expect(tag).toContain('border-dashed')
    expect(tag).not.toContain('role="radio"')
  })

  it('shows the chosen icon as the checked choice when there is no photo', () => {
    const html = render({ value: 'utensils' })

    expect(tagNamed(html, 'Utensils')).toContain('aria-checked="true"')
    expect(html).not.toContain('aria-label="Your photo"')
  })

  it('shows the photo as the checked choice, and no icon, when the tile has one', () => {
    const html = render({ value: 'utensils', photoUrl: PHOTO, isPhotoChosen: true })

    const photo = tagNamed(html, 'Your photo')
    expect(photo).toContain('role="radio"')
    expect(photo).toContain('aria-checked="true"')
    expect(tagNamed(html, 'Utensils')).toContain('aria-checked="false"')
    expect(html).toContain(`src="${PHOTO}"`)
  })

  it('declares the photo box, so nothing moves when it arrives', () => {
    const html = render({ photoUrl: PHOTO })
    const image = html.slice(
      html.indexOf(`<img`),
      html.indexOf('>', html.indexOf('<img')),
    )

    expect(image).toContain('width="40"')
    expect(image).toContain('height="40"')
    expect(image).toContain('alt=""')
  })

  it('offers a replacement rather than a first photo once there is one', () => {
    const html = render({ photoUrl: PHOTO, isPhotoChosen: true })

    expect(html).toContain('aria-label="Replace photo"')
    expect(html).not.toContain('aria-label="Upload a photo instead of an icon"')
  })

  it('keeps the photo on offer, unchecked, while an icon is chosen over it', () => {
    const html = render({ value: 'wifi', photoUrl: PHOTO, isPhotoChosen: false })

    expect(tagNamed(html, 'Your photo')).toContain('aria-checked="false"')
    expect(tagNamed(html, 'Wifi')).toContain('aria-checked="true"')
    // Nothing is on the tile to replace, so the dashed tile still invites a first photo.
    expect(html).toContain('aria-label="Upload a photo instead of an icon"')
  })

  it('makes every choice a tap target tall on a phone, the upload tile included', () => {
    const html = render({ photoUrl: PHOTO })

    for (const name of ['Utensils', 'Your photo', 'Upload a photo instead of an icon']) {
      expect(tagNamed(html, name)).toContain('max-md:size-(--control-touch)')
    }
  })

  it('leaves the checked state of a choice to the radio, not to its tooltip', () => {
    const html = render({ value: 'wifi' })

    expect(tagNamed(html, 'Wifi')).toContain('data-state="checked"')
    expect(tagNamed(html, 'Utensils')).toContain('data-state="unchecked"')
  })

  it('disables every choice and the upload for someone who may not edit', () => {
    const html = render({ disabled: true, photoUrl: PHOTO, isPhotoChosen: true })

    expect(tagNamed(html, 'Replace photo')).toContain('disabled=""')
    expect(tagNamed(html, 'Your photo')).toContain('disabled=""')
    expect(tagNamed(html, 'Utensils')).toContain('disabled=""')
  })
})

// What an identity image looks like in each state (UI consistency scan: FORM-14).
//
// The avatar was a hover-to-replace circle with an icon-only corner button, the logo
// the same circle beside the page title, the Property look logo a pair of text buttons.
// The setting draws the picture and says what can be done with it in words, always:
// Upload, or Replace and Remove, each a Button named for what the image is. The
// behaviour (pending, a refusal, the picture staying put) is `use-image-setting` and
// is played in the story.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImageSettingView, type ImageSettingViewProps } from './image-setting-view'

const IMAGE = '/api/public/identity-assets/organizations/org-1/logo/abc'

const baseProps: ImageSettingViewProps = {
  subject: 'logo',
  imageUrl: null,
  status: 'idle',
  progress: 0,
  disabled: false,
  help: 'JPG, PNG, WebP or GIF, up to 5 MB.',
  dragOver: false,
  acceptedTypes: ['image/png'],
  inputRef: { current: null },
  chooseRef: { current: null },
  onChoose: () => undefined,
  onFile: () => undefined,
  onRemove: () => undefined,
  dropProps: {
    onDragOver: () => undefined,
    onDragLeave: () => undefined,
    onDrop: () => undefined,
  },
}

const render = (props: Partial<ImageSettingViewProps> = {}) =>
  renderToStaticMarkup(createElement(ImageSettingView, { ...baseProps, ...props }))

/** The opening tag of the first button whose text is `label`. */
function buttonTag(markup: string, label: string): string {
  const match = new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}`, 'u').exec(markup)
  if (!match) throw new Error(`no button "${label}"`)
  return /^<button[^>]*>/u.exec(match[0])![0]
}

describe('ImageSettingView with no image', () => {
  const html = render()

  it('offers Upload, named for what is being set', () => {
    expect(html).toContain('Upload logo')
    expect(html).not.toContain('Replace logo')
    expect(html).not.toContain('Remove logo')
  })

  it('shows no picture and says there is none', () => {
    expect(html).not.toContain('<img')
    expect(html).toContain('No logo yet')
  })

  it('prints what may be chosen under the buttons', () => {
    expect(html).toContain('JPG, PNG, WebP or GIF, up to 5 MB.')
  })
})

describe('ImageSettingView with an image', () => {
  const html = render({ imageUrl: IMAGE })

  it('shows the picture with a text alternative', () => {
    expect(html).toContain(`src="${IMAGE}"`)
    expect(html).toContain('alt="Current logo"')
  })

  it('always shows Replace and Remove as words, not on hover and not as a glyph', () => {
    expect(html).toContain('Replace logo')
    expect(html).toContain('Remove logo')
    expect(html).not.toContain('Upload logo')
    expect(html).not.toMatch(/opacity-0|group-hover/u)
  })

  it('keeps the file input out of the tab order: the buttons are the stops', () => {
    expect(html).toMatch(/<input[^>]*type="file"[^>]*tabindex="-1"/u)
    expect(html).toMatch(/<input[^>]*type="file"[^>]*hidden/u)
    expect(html).toContain('accept="image/png"')
  })
})

describe('ImageSettingView while a file is uploading', () => {
  const html = render({ imageUrl: IMAGE, status: 'uploading', progress: 42 })

  it('puts the Replace button into its pending state, in words', () => {
    const tag = buttonTag(html, 'Uploading…')

    expect(tag).toContain('aria-busy="true"')
    expect(tag).toContain('disabled')
  })

  it('shows the progress on the picture and holds Remove still', () => {
    expect(html).toContain('42%')
    expect(buttonTag(html, 'Remove logo')).toContain('disabled')
  })

  it('marks the whole setting busy for assistive technology', () => {
    expect(html).toMatch(/data-slot="image-setting"[^>]*aria-busy="true"/u)
  })
})

describe('ImageSettingView while the image is being removed', () => {
  const html = render({ imageUrl: IMAGE, status: 'removing' })

  it('puts Remove into its pending state and holds Replace still', () => {
    expect(buttonTag(html, 'Removing…')).toContain('aria-busy="true"')
    expect(buttonTag(html, 'Replace logo')).toContain('disabled')
  })

  it('keeps the picture until the removal is saved', () => {
    expect(html).toContain(`src="${IMAGE}"`)
  })
})

describe('ImageSettingView when disabled', () => {
  const html = render({ imageUrl: IMAGE, disabled: true })

  it('disables every control', () => {
    expect(buttonTag(html, 'Replace logo')).toContain('disabled')
    expect(buttonTag(html, 'Remove logo')).toContain('disabled')
    expect(html).toMatch(/<input[^>]*type="file"[^>]*disabled/u)
  })
})

describe('ImageSettingView when a file is dragged over it', () => {
  it('rings the picture', () => {
    expect(render({ dragOver: true })).toContain('ring-primary')
    expect(render()).not.toContain('ring-primary')
  })
})

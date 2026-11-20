// Specimen of the self-hosted guest fonts (Cormorant Garamond + Ysabeau Office).
// The Bulgarian block carries `lang="bg"` so the browser picks the Bulgarian
// letterforms (в г д з и й к л п т ц ч ш щ ю я) where the font has them, and
// the play function proves the Cyrillic subsets really load from our own
// origin, not from a fallback.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, waitFor } from 'storybook/test'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'

const displayStyle = {
  fontFamily: 'var(--font-guest-display)',
  fontWeight: 600,
  fontSize: '2rem',
  lineHeight: 1.15,
} as const
const italicStyle = {
  fontFamily: 'var(--font-guest-display)',
  fontStyle: 'italic',
  fontWeight: 500,
  fontSize: '1.25rem',
} as const
const bodyStyle = {
  fontFamily: 'var(--font-guest-body)',
  fontSize: '1rem',
  lineHeight: 1.5,
} as const
const bodyStrongStyle = { ...bodyStyle, fontWeight: 600 } as const

function GuestFontSpecimen() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 p-6">
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} />
      <section lang="en" aria-labelledby="specimen-en" className="flex flex-col gap-2">
        <h1 id="specimen-en" style={displayStyle}>
          How was your visit?
        </h1>
        <p style={italicStyle}>Thank you for telling us.</p>
        <p style={bodyStyle}>Your rating helps the team look after the next guest.</p>
        <p style={bodyStrongStyle}>Rate your visit</p>
      </section>
      <section lang="bg" aria-labelledby="specimen-bg" className="flex flex-col gap-2">
        <h2 id="specimen-bg" style={displayStyle}>
          Как мина посещението ви?
        </h2>
        <p style={italicStyle}>Благодарим ви, че ни казахте.</p>
        <p style={bodyStyle}>
          Оценката ви помага на екипа да се погрижи за следващия гост, ъ ю я щ ч ш.
        </p>
        <p style={bodyStrongStyle}>Оценете посещението си</p>
      </section>
      <section lang="de" aria-labelledby="specimen-de" className="flex flex-col gap-2">
        <h2 id="specimen-de" style={displayStyle}>
          Wie war Ihr Besuch?
        </h2>
        <p style={bodyStyle}>Größe, Übung, Straße, Łódź, Ţară, ș ț ă.</p>
      </section>
    </main>
  )
}

const meta: Meta<typeof GuestFontSpecimen> = {
  title: 'Guest/GuestFonts',
  component: GuestFontSpecimen,
  parameters: { layout: 'fullscreen', theme: 'light' },
}
export default meta
type Story = StoryObj<typeof GuestFontSpecimen>

async function guestStylesheetLoaded() {
  await waitFor(() =>
    expect(
      Array.from(document.styleSheets).some((sheet) =>
        sheet.href?.endsWith(GUEST_FONT_STYLESHEET),
      ),
    ).toBe(true),
  )
}

export const LatinAndBulgarian: Story = {
  play: async () => {
    await guestStylesheetLoaded()
    const loaded = await Promise.all([
      document.fonts.load('600 32px "Cormorant Garamond"', 'How was your visit?'),
      document.fonts.load('600 32px "Cormorant Garamond"', 'Как мина посещението ви?'),
      document.fonts.load('italic 500 20px "Cormorant Garamond"', 'Благодарим ви'),
      document.fonts.load('400 16px "Ysabeau Office"', 'Your rating helps'),
      document.fonts.load('400 16px "Ysabeau Office"', 'Оценката ви помага'),
      document.fonts.load('600 16px "Ysabeau Office"', 'Оценете посещението си'),
      document.fonts.load('600 32px "Cormorant Garamond"', 'Größe Łódź'),
    ])
    for (const faces of loaded) {
      expect(faces.length).toBeGreaterThan(0)
      for (const face of faces) expect(face.status).toBe('loaded')
    }
    expect(document.fonts.check('600 32px "Cormorant Garamond"', 'Как мина')).toBe(true)
    expect(document.fonts.check('400 16px "Ysabeau Office"', 'Оценката')).toBe(true)
  },
}

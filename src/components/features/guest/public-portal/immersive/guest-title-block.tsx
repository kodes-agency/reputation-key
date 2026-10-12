import { titleRepeatsName } from '../guest-title'

/** A piece of page text; `lang` is set when it was copied from another language than the page's. */
export type ImmersiveText = Readonly<{ value: string; lang?: string }>

export type GuestTitleBlockProps = Readonly<{
  /** The portal's title in the page's language: the small line above the name. */
  title: ImmersiveText
  displayName: string
}>

/**
 * The title block of board G01. The portal's title is the page's `h1`, set as a
 * small spaced kicker; the property's display name is the large serif line
 * beneath it. A portal titled with the property's own name would print it
 * twice, so then the one `h1` is the large line alone (a name has no language
 * to declare).
 */
export function GuestTitleBlock({ title, displayName }: GuestTitleBlockProps) {
  const lang = title.value && title.lang ? title.lang : undefined
  const repeatsName = titleRepeatsName(title.value, displayName)
  return (
    <div className="ih-title">
      {repeatsName ? (
        <h1 className="ih-display ih-title__name">{displayName}</h1>
      ) : (
        <>
          <h1 className="ih-title__kicker" lang={lang}>
            {title.value}
          </h1>
          <p className="ih-display ih-title__name">{displayName}</p>
        </>
      )}
    </div>
  )
}

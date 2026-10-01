import { Clock } from 'lucide-react'
import { createElement, useId, type MouseEvent, type ReactNode } from 'react'
import { LinktreeArrow, linktreeIconFor } from './linktree-icons'
import {
  followLinktreeLink,
  isPlainPrimaryClick,
  type LinktreeSelect,
} from './linktree-follow'
import { LINKTREE_CSS, LINKTREE_STYLE_HREF } from './linktree-styles'

/** One tile as the page receives it: wording in the page's language, never a destination. */
export type ImmersiveLinktreeLink = Readonly<{
  id: string
  /** A key of the closed icon set, or null for the default tile. */
  iconKey: string | null
  /** A served photo URL; when present the tile is a photo tile. */
  imageUrl: string | null
  label: string
  line: string | null
  /** Set when label and line were copied from another language; it becomes their `lang`. */
  fallbackFrom: string | null
  /**
   * A tile with no approved address, drawn only in an inert preview: a dashed
   * glass tile that gives `note` in place of its line. A live page ignores it,
   * because a live page never carries a tile it cannot open.
   */
  placeholder?: ImmersiveLinktreePlaceholder
}>

export type ImmersiveLinktreePlaceholder = Readonly<{
  /** Why the tile is a placeholder; it becomes the tile's `data-ih-tile-placeholder`. */
  kind: string
  note: string
}>

type LinktreeContent = Readonly<{
  /** The portal's Linktree switch. Off, or with no link, nothing renders. */
  enabled: boolean
  title: Readonly<{ value: string; fallbackFrom: string | null }>
  /** The language pack's default title, used when the stored title is blank. */
  defaultTitle: string
  links: ReadonlyArray<ImmersiveLinktreeLink>
}>

export type ImmersiveLinktreeProps = LinktreeContent &
  Readonly<{
    /** Where a tile goes: the click route on a public page. */
    hrefFor: (linkId: string) => string
    /**
     * Present only after a rating (see `bindLinkSelector`). It records a qualified
     * link action and resolves the destination. Absent, a tile is a plain link to
     * `hrefFor`, which is how every tap before a rating works.
     */
    selectLink?: LinktreeSelect
  }>

/** The admin's preview takes the content alone: it has no address to give a tile. */
export type InertImmersiveLinktreeProps = LinktreeContent

const PHOTO_WIDTH = 420
const PHOTO_HEIGHT = 194
const ICON_SIZE = 17
const ICON_STROKE = 1.7
const ARROW_SIZE = 15
const PHOTO_ARROW_SIZE = 13

function goTo(url: string) {
  window.location.assign(url)
}

/**
 * The Linktree of the Immersive Hub (board G01, G09, G10): the guest page's
 * link tiles, in a two-column grid under the rating card. It is visible from
 * arrival and in every state after it, and it never competes with the rating
 * card: the card stays first and dominant (ADR 0044, amendment 2026-10-01).
 *
 * Pure: it holds no session and calls no server function. The tile's click
 * behaviour is decided by the `selectLink` the container hands in, or its
 * absence.
 */
export function ImmersiveLinktree({
  hrefFor,
  selectLink,
  ...content
}: ImmersiveLinktreeProps) {
  return (
    <LinktreeSection
      {...content}
      tile={(link) => (
        <LinktreeTile link={link} hrefFor={hrefFor} selectLink={selectLink} />
      )}
    />
  )
}

/**
 * The Linktree as the admin's preview draws it: the same section and tiles, but
 * a picture. A tile is neither a link nor a button, because the preview has no
 * address to open and must not follow one, and nothing is recorded. A link with
 * a `placeholder` is drawn as a waiting tile.
 */
export function InertImmersiveLinktree(props: InertImmersiveLinktreeProps) {
  return <LinktreeSection {...props} tile={(link) => <InertTile link={link} />} />
}

function LinktreeSection({
  enabled,
  title,
  defaultTitle,
  links,
  tile,
}: LinktreeContent & Readonly<{ tile: (link: ImmersiveLinktreeLink) => ReactNode }>) {
  const titleId = useId()
  if (!enabled || links.length === 0) return null
  const hasTitle = title.value.trim().length > 0
  const heading = hasTitle ? title.value : defaultTitle
  const headingLang = hasTitle ? (title.fallbackFrom ?? undefined) : undefined
  return (
    <section className="ih-linktree">
      <style href={LINKTREE_STYLE_HREF} precedence="default">
        {LINKTREE_CSS}
      </style>
      <h2 id={titleId} className="ih-display ih-linktree__title" lang={headingLang}>
        {heading}
      </h2>
      {/* Named by the heading, not by a copy of its text: the name keeps the heading's `lang`. */}
      <nav aria-labelledby={titleId}>
        <ul className="ih-linktree__grid">
          {links.map((link) => (
            <li key={link.id} className="ih-linktree__item">
              {tile(link)}
            </li>
          ))}
        </ul>
      </nav>
    </section>
  )
}

function LinktreeTile({
  link,
  hrefFor,
  selectLink,
}: Readonly<{
  link: ImmersiveLinktreeLink
  hrefFor: (linkId: string) => string
  selectLink?: LinktreeSelect
}>) {
  const href = hrefFor(link.id)
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!selectLink || !isPlainPrimaryClick(event)) return
    event.preventDefault()
    void followLinktreeLink({
      linkId: link.id,
      href,
      select: selectLink,
      navigate: goTo,
    })
  }
  return link.imageUrl ? (
    <a href={href} onClick={onClick} rel="noreferrer" className="ih-tile ih-tile--photo">
      <PhotoTileBody link={link} imageUrl={link.imageUrl} />
    </a>
  ) : (
    <a
      href={href}
      onClick={onClick}
      rel="noreferrer"
      className="ih-glass ih-glass--tile ih-tile ih-tile--icon"
    >
      <IconTileBody link={link} />
    </a>
  )
}

/**
 * A tile drawn as a picture: the markup of the live tile in a `div`, so there is
 * nothing to follow, focus or press.
 */
function InertTile({ link }: Readonly<{ link: ImmersiveLinktreeLink }>) {
  const { placeholder } = link
  if (placeholder) return <WaitingTile link={link} placeholder={placeholder} />
  return link.imageUrl ? (
    <div className="ih-tile ih-tile--photo ih-tile--inert">
      <PhotoTileBody link={link} imageUrl={link.imageUrl} />
    </div>
  ) : (
    <div className="ih-glass ih-glass--tile ih-tile ih-tile--icon ih-tile--inert">
      <IconTileBody link={link} />
    </div>
  )
}

/**
 * The tile of a link with no approved address: publishing leaves it out, so a
 * manager sees why a tile they made is missing from the page. It keeps its
 * words, shows a clock for its icon and gives the reason in place of its line.
 */
function WaitingTile({
  link,
  placeholder,
}: Readonly<{ link: ImmersiveLinktreeLink; placeholder: ImmersiveLinktreePlaceholder }>) {
  return (
    <div
      className="ih-glass ih-glass--tile ih-tile ih-tile--icon ih-tile--waiting ih-tile--inert"
      data-ih-tile-placeholder={placeholder.kind}
    >
      <span className="ih-tile__top">
        <span className="ih-tile__icon" aria-hidden="true">
          <Clock size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </span>
      </span>
      <span className="ih-tile__text" lang={link.fallbackFrom ?? undefined}>
        <span className="ih-tile__label">{link.label}</span>
        <span className="ih-tile__line">{placeholder.note}</span>
      </span>
    </div>
  )
}

function PhotoTileBody({
  link,
  imageUrl,
}: Readonly<{ link: ImmersiveLinktreeLink; imageUrl: string }>) {
  return (
    <>
      <img
        className="ih-tile__image"
        src={imageUrl}
        alt=""
        width={PHOTO_WIDTH}
        height={PHOTO_HEIGHT}
        loading="lazy"
        decoding="async"
      />
      <span className="ih-tile__top">
        <LinktreeArrow
          className="ih-tile__arrow"
          size={PHOTO_ARROW_SIZE}
          strokeWidth={2}
          aria-hidden="true"
        />
      </span>
      <TileText link={link} />
    </>
  )
}

function IconTileBody({ link }: Readonly<{ link: ImmersiveLinktreeLink }>) {
  return (
    <>
      <span className="ih-tile__top">
        <TileIcon iconKey={link.iconKey} />
        <LinktreeArrow
          className="ih-tile__arrow"
          size={ARROW_SIZE}
          strokeWidth={2}
          aria-hidden="true"
        />
      </span>
      <TileText link={link} />
    </>
  )
}

function TileIcon({ iconKey }: Readonly<{ iconKey: string | null }>) {
  const Icon = linktreeIconFor(iconKey)
  if (!Icon) return null
  return (
    <span className="ih-tile__icon" aria-hidden="true">
      {createElement(Icon, {
        size: ICON_SIZE,
        strokeWidth: ICON_STROKE,
        'aria-hidden': true,
      })}
    </span>
  )
}

/** Label and line are one text in one language, so they share the fallback `lang`. */
function TileText({ link }: Readonly<{ link: ImmersiveLinktreeLink }>) {
  return (
    <span className="ih-tile__text" lang={link.fallbackFrom ?? undefined}>
      <span className="ih-tile__label">{link.label}</span>
      {link.line && <span className="ih-tile__line">{link.line}</span>}
    </span>
  )
}

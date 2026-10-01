// The Linktree of the previewed page: its title and one glass tile per link.
//
// A tile is a button, never a link: the preview has no address to open (see
// `portal-preview.ts`), and it must not follow one. A tile whose address is not
// approved is a dashed placeholder that says so, because publishing leaves it
// out and a manager should see why a tile they made is missing from the page.

import { Clock } from 'lucide-react'
import { glassClassName } from '#/components/features/guest'
import type {
  PortalPreviewExperience,
  PortalPreviewLink,
} from '#/contexts/portal/application/public-api'
import { LINK_ICONS, linkIconKeyOrDefault } from '../link-tree/link-icons'
import { TILE_PLACEHOLDER_NOTE } from './portal-preview-rules'
import { previewStyles as styles } from './preview-page-styles'

type Props = Readonly<{
  experience: PortalPreviewExperience
  idPrefix: string
}>

export function PreviewLinktree({ experience, idPrefix }: Props) {
  const { linktree, links, content } = experience
  if (!linktree.enabled || links.length === 0) return null
  const headingId = `${idPrefix}-linktree-title`
  return (
    <>
      <h2
        id={headingId}
        data-preview-part="linktree"
        className="ih-display"
        style={styles.heading}
        lang={content.linktreeTitle.fallbackFrom ?? undefined}
      >
        {content.linktreeTitle.value}
      </h2>
      <nav aria-labelledby={headingId} style={styles.tiles}>
        {links.map((link) => (
          <PreviewTile key={link.id} link={link} />
        ))}
      </nav>
    </>
  )
}

function PreviewTile({ link }: Readonly<{ link: PortalPreviewLink }>) {
  const Icon = LINK_ICONS[linkIconKeyOrDefault(link.iconKey)]
  const isWaiting = link.state !== 'ready'
  const label = link.label === '' ? 'Untitled link' : link.label
  const fallbackLang = link.fallbackFrom ?? undefined
  return (
    <button
      type="button"
      data-preview-tile={link.state}
      className={glassClassName('tile')}
      style={isWaiting ? { ...styles.tile, ...styles.tileWaiting } : styles.tile}
    >
      <span aria-hidden="true" style={styles.tileIcon}>
        {isWaiting ? <Clock size={20} /> : <Icon size={20} />}
      </span>
      <span style={styles.tileLabel} lang={fallbackLang}>
        {label}
      </span>
      {isWaiting ? (
        <span style={styles.tileWaitingNote}>{TILE_PLACEHOLDER_NOTE[link.state]}</span>
      ) : link.line === null ? null : (
        <span style={styles.tileLine} lang={fallbackLang}>
          {link.line}
        </span>
      )}
    </button>
  )
}

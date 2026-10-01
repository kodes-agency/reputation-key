// The Linktree section's body: the title guests read above the tiles, the tiles
// themselves (up to four, each opening into its editor), and adding one. Every
// change is saved as it is made (typed text through the portal's autosave,
// re-ordering, icons and the address as their own writes); the section's switch
// sits in its heading (linktree-section.tsx).

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { Button } from '#/components/ui/button'
import type {
  PortalLinktreeLink,
  PortalLinktreeView,
} from '#/contexts/portal/application/public-api'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalLinkIconKey } from '#/shared/domain/portal-link-icon'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import { LinkAddForm } from './link-add-form'
import {
  iconChoiceWrite,
  photoChoiceWrite,
  rememberPhotos,
  type PhotoMemory,
} from './linktree-photo-rules'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'
import { LinktreeLocaleTabs } from './linktree-locale-tabs'
import { LINKTREE_MOVE_HINT_ID } from './linktree-move-controls'
import { LinktreeTileEditor } from './linktree-tile-editor'
import { LinktreeTile } from './linktree-tile'
import { LinktreeTitleForm } from './linktree-title-form'
import {
  applyLinkOrder,
  describeLinkCap,
  linkLabelFor,
  offeredLocales,
  planLinkMove,
  type LinkMoveControl,
  type LinkMoveDirection,
  type LinkOrderPlan,
} from './linktree-rules'
import type { LinktreeMutations } from './use-linktree-mutations'

type Props = Readonly<{
  propertyId: string
  view: PortalLinktreeView
  mutations: LinktreeMutations
  /** User id to full name, for "Approved · Elena Petrova". */
  memberNames: ReadonlyMap<string, string>
  canEdit: boolean
  /** Deleting a link is the account admin's alone; a manager who can edit may not. */
  canDelete: boolean
  /** The photo upload; the real one unless a story hands in a stub. */
  uploadPhoto?: PortalImageUploader
}>

export function LinkTree({
  propertyId,
  view,
  mutations,
  memberNames,
  canEdit,
  canDelete,
  uploadPhoto,
}: Props) {
  const autosave = usePortalDraftAutosave()
  const locales = offeredLocales(view.locales)
  const [openId, setOpenId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [titleChoice, setTitleChoice] = useState<OfferedGuestLocale | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Moves asked for that the server has not finished with. Each one is planned
  // from the order the person saw, which already holds the moves before it, so a
  // quick second press never plans from a stale list or undoes the first.
  const [plans, setPlans] = useState<ReadonlyArray<LinkOrderPlan>>([])
  const links: ReadonlyArray<PortalLinktreeLink> = plans.reduce(
    applyLinkOrder,
    view.links,
  )
  // A photo an icon has replaced stays on offer, so choosing an icon is never
  // the end of the photo. Noted while rendering (the supported way to derive
  // state from props), so no frame shows the tile without it.
  const [photos, setPhotos] = useState<PhotoMemory>({})
  const remembered = rememberPhotos(photos, view.links)
  if (remembered !== photos) setPhotos(remembered)
  const refocus = useRef<string | null>(null)
  const order = links.map((link) => link.id).join()
  const cap = describeLinkCap(view.links.length, view.maxLinks)
  const titleLocale = titleChoice ?? locales[0]

  // A re-ordered tile keeps the control the keyboard was on.
  useEffect(() => {
    const wanted = refocus.current
    if (wanted === null) return
    refocus.current = null
    const [linkId] = wanted.split(':')
    document
      .querySelector<HTMLElement>(`[data-link-move="${wanted}"]:not(:disabled)`)
      ?.focus()
    if (document.activeElement?.getAttribute('data-link-move') === null) {
      document
        .querySelector<HTMLElement>(`[data-link-move^="${linkId}:"]:not(:disabled)`)
        ?.focus()
    }
  }, [order])

  // The section's writes run one after another, each after the typed text still
  // waiting out its debounce: every write reads the Portal afresh, so two at once
  // (a quick second move, an add beside a title edit) would refuse the second.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const waiting = useRef(0)
  const afterPendingText = <T,>(write: () => Promise<T>): Promise<T> => {
    waiting.current += 1
    const run = queue.current
      .catch(() => undefined)
      .then(async () => {
        await autosave.flush()
        return write()
      })
    queue.current = run
    const settle = () => {
      waiting.current -= 1
      // Once the queue is empty the cache holds the truth, saved or rolled back.
      if (waiting.current === 0) setPlans([])
    }
    run.then(settle, settle)
    return run
  }
  const reportFailure = (error: unknown) => toast.error(actionErrorMessage(error))

  const move = (
    linkId: string,
    direction: LinkMoveDirection,
    control: LinkMoveControl,
  ) => {
    const plan = planLinkMove(links, linkId, direction)
    if (plan === null) return
    setPlans((earlier) => [...earlier, plan])
    refocus.current = `${linkId}:${control}`
    const position = plan.items.findIndex((item) => item.id === linkId) + 1
    const link = links.find((candidate) => candidate.id === linkId)
    setAnnouncement(
      `Moved ${link ? linkLabelFor(link, view.primaryLocale).label : 'the link'} to position ${position} of ${plan.items.length}`,
    )
    void afterPendingText(() =>
      mutations.reorderLinks({
        data: {
          categoryId: plan.categoryId,
          portalId: view.portalId,
          items: [...plan.items],
        },
      }),
    ).catch(() => undefined)
  }

  const changeIcon = (link: PortalLinktreeLink, iconKey: PortalLinkIconKey) => {
    void afterPendingText(() =>
      mutations.updateLink({ data: iconChoiceWrite(link, iconKey) }),
    ).catch(reportFailure)
  }

  // The photo dialog shows a refusal itself, so this one is not reported here.
  const choosePhoto = (link: PortalLinktreeLink, assetId: string) =>
    afterPendingText(() =>
      mutations.updateLink({ data: photoChoiceWrite(link, assetId) }),
    )

  // Putting back a photo an icon replaced has no dialog to report to.
  const restorePhoto = (link: PortalLinktreeLink, assetId: string) => {
    void choosePhoto(link, assetId).catch(reportFailure)
  }

  const checkAddress = (linkId: string, url: string) => {
    void afterPendingText(() => mutations.updateLink({ data: { linkId, url } })).catch(
      () => undefined,
    )
  }

  const remove = (linkId: string) => {
    if (openId === linkId) setOpenId(null)
    void afterPendingText(() => mutations.deleteLink({ data: { linkId } })).catch(
      () => undefined,
    )
  }

  return (
    <div className="space-y-6">
      {titleLocale === undefined ? null : (
        <div className="space-y-2">
          <LinktreeLocaleTabs
            aria-label="Title language"
            locales={locales}
            active={titleLocale}
            onChange={setTitleChoice}
          />
          <LinktreeTitleForm
            portalId={view.portalId}
            titles={view.titles}
            locales={locales}
            locale={titleLocale}
            save={mutations.saveSettings}
            disabled={!canEdit}
          />
        </div>
      )}
      {view.enabled ? null : (
        <p className="text-sm text-muted-foreground">
          The Linktree is hidden from the page. Your links are kept.
        </p>
      )}
      {links.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No links yet. Add up to {view.maxLinks} tiles under the rating card.
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <LinktreeTile
              key={link.id}
              link={link}
              primaryLocale={view.primaryLocale}
              locales={view.locales}
              isOpen={openId === link.id}
              onToggle={() => {
                // Closing a tile writes what was typed in it first.
                void autosave.flush()
                setOpenId(openId === link.id ? null : link.id)
              }}
              canEdit={canEdit}
              canDelete={canDelete}
              canMoveUp={planLinkMove(links, link.id, 'up') !== null}
              canMoveDown={planLinkMove(links, link.id, 'down') !== null}
              onMove={(direction, control) => move(link.id, direction, control)}
              onDelete={() => remove(link.id)}
            >
              <LinktreeTileEditor
                link={link}
                view={view}
                locales={locales}
                mutations={mutations}
                memberNames={memberNames}
                addressError={
                  mutations.updateFailure?.linkId === link.id
                    ? mutations.updateFailure.error
                    : null
                }
                onAddressEdit={mutations.clearUpdateFailure}
                onIconChange={(key) => changeIcon(link, key)}
                onPhotoChange={(assetId) => choosePhoto(link, assetId)}
                onPhotoRestore={(assetId) => restorePhoto(link, assetId)}
                rememberedPhotoId={remembered[link.id] ?? null}
                propertyId={propertyId}
                uploadPhoto={uploadPhoto}
                onCheckAddress={() => checkAddress(link.id, link.url)}
                canEdit={canEdit}
              />
            </LinktreeTile>
          ))}
        </ul>
      )}
      {isAdding ? (
        <LinkAddForm
          portalId={view.portalId}
          create={mutations.createLink}
          enqueue={afterPendingText}
          onAdded={(linkId) => {
            setIsAdding(false)
            setOpenId(linkId)
          }}
          onCancel={() => setIsAdding(false)}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && !isAdding ? (
          <Button
            type="button"
            variant="outline"
            disabled={cap.isFull}
            onClick={() => setIsAdding(true)}
          >
            <Plus aria-hidden="true" />
            Add link
          </Button>
        ) : null}
        <p className="text-sm text-muted-foreground">{cap.text}</p>
      </div>
      <p id={LINKTREE_MOVE_HINT_ID} className="sr-only">
        Press the up or down arrow key to move this tile.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

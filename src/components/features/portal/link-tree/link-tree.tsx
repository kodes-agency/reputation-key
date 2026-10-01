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
import type { PortalLinktreeView } from '#/contexts/portal/application/public-api'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalLinkIconKey } from '#/shared/domain/portal-link-icon'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import { LinkAddForm } from './link-add-form'
import { LinktreeLocaleTabs } from './linktree-locale-tabs'
import { LinktreeTileEditor } from './linktree-tile-editor'
import { LinktreeTile } from './linktree-tile'
import { LinktreeTitleForm } from './linktree-title-form'
import {
  describeLinkCap,
  linkLabelFor,
  offeredLocales,
  planLinkMove,
  type LinkMoveDirection,
} from './linktree-rules'
import type { LinktreeMutations } from './use-linktree-mutations'

type Props = Readonly<{
  view: PortalLinktreeView
  mutations: LinktreeMutations
  /** User id to full name, for "Approved · Elena Petrova". */
  memberNames: ReadonlyMap<string, string>
  canEdit: boolean
  /** Deleting a link is the account admin's alone; a manager who can edit may not. */
  canDelete: boolean
}>

export function LinkTree({ view, mutations, memberNames, canEdit, canDelete }: Props) {
  const autosave = usePortalDraftAutosave()
  const locales = offeredLocales(view.locales)
  const [openId, setOpenId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [titleChoice, setTitleChoice] = useState<OfferedGuestLocale | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const refocus = useRef<string | null>(null)
  const order = view.links.map((link) => link.id).join()
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
  const afterPendingText = <T,>(write: () => Promise<T>): Promise<T> => {
    const run = queue.current
      .catch(() => undefined)
      .then(async () => {
        await autosave.flush()
        return write()
      })
    queue.current = run
    return run
  }
  const reportFailure = (error: unknown) => toast.error(actionErrorMessage(error))

  const move = (linkId: string, direction: LinkMoveDirection) => {
    const plan = planLinkMove(view.links, linkId, direction)
    if (plan === null) return
    refocus.current = `${linkId}:${direction}`
    const position = plan.items.findIndex((item) => item.id === linkId) + 1
    const link = view.links.find((candidate) => candidate.id === linkId)
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

  const changeIcon = (linkId: string, iconKey: PortalLinkIconKey) => {
    void afterPendingText(() =>
      mutations.updateLink({ data: { linkId, iconKey } }),
    ).catch(reportFailure)
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
      {view.links.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No links yet. Add up to {view.maxLinks} tiles under the rating card.
        </p>
      ) : (
        <ul className="space-y-2">
          {view.links.map((link) => (
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
              canMoveUp={planLinkMove(view.links, link.id, 'up') !== null}
              canMoveDown={planLinkMove(view.links, link.id, 'down') !== null}
              onMove={(direction) => move(link.id, direction)}
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
                onIconChange={(key) => changeIcon(link.id, key)}
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
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

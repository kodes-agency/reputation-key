// The autosaved writes of a portal's own look, as plain functions: what is sent,
// when nothing is, and what the server then holds. The editor's autosave runs
// them (and the coordinator turns a throw into "Not saved" with a retry), so they
// decide nothing about timing. Each answers with the outcome the coordinator
// understands and what the server holds now, which the next call compares with.
import type {
  PortalLookColoursInput,
  PortalLookIdentityInput,
  PortalLookPhotoInput,
} from '#/contexts/portal/application/portal-management-contracts'
import type { PortalDraftSaveOutcome } from './portal-draft-autosave'
import { sameFocal, type FocalPoint } from '#/contexts/portal/look/ui/focal-point'
import type { ColoursDraft } from '#/contexts/portal/look/ui/property-look-colours-section'
import {
  coloursAreUnchanged,
  coloursInputOf,
  coloursProblemOf,
  focalInputOf,
  wordmarkInputOf,
  wordmarkProblemOf,
} from '#/contexts/portal/look/ui/portal-look-rules'
import type { PortalLookTarget } from '#/contexts/portal/look/ui/portal-look-types'

/** One autosaved write: the draft against what the server holds, and what it holds afterwards. */
export type PortalLookSave<T> = (
  draft: T,
  saved: T | null,
) => Promise<Readonly<{ outcome: PortalDraftSaveOutcome; saved: T | null }>>

type Send<Input> = (args: { data: Input }) => Promise<unknown>

export const saveColoursDraft =
  (
    target: PortalLookTarget,
    send: Send<PortalLookColoursInput>,
  ): PortalLookSave<ColoursDraft> =>
  async (draft, saved) => {
    if (saved !== null && coloursAreUnchanged(saved, draft))
      return { outcome: 'unchanged', saved }
    // Colours the page cannot show are not written; the readout beside them says why.
    if (coloursProblemOf(draft) !== null) return { outcome: 'invalid', saved }
    await send({ data: coloursInputOf(target, draft) })
    return { outcome: 'saved', saved: draft }
  }

export const saveWordmarkDraft =
  (
    target: PortalLookTarget,
    send: Send<PortalLookIdentityInput>,
  ): PortalLookSave<string> =>
  async (draft, saved) => {
    if (saved !== null && saved.trim() === draft.trim())
      return { outcome: 'unchanged', saved }
    if (wordmarkProblemOf(draft) !== null) return { outcome: 'invalid', saved }
    await send({ data: wordmarkInputOf(target, draft) })
    return { outcome: 'saved', saved: draft }
  }

export const saveFocalDraft =
  (
    target: PortalLookTarget,
    send: Send<PortalLookPhotoInput>,
  ): PortalLookSave<FocalPoint> =>
  async (draft, saved) => {
    if (saved !== null && sameFocal(saved, draft)) return { outcome: 'unchanged', saved }
    await send({ data: focalInputOf(target, draft) })
    return { outcome: 'saved', saved: draft }
  }

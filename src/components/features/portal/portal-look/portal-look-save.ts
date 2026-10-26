// The autosaved writes of a portal's own look, as plain functions: what is sent,
// when nothing is, and what the server then holds. The editor's autosave runs
// them (and the coordinator turns a throw into "Not saved" with a retry), so they
// decide nothing about timing. Each answers with the outcome the coordinator
// understands and what the server holds now, which the next call compares with.

import type {
  PortalLookColoursInput,
  PortalLookIdentityInput,
  PortalLookPhotoInput,
} from '#/contexts/portal/application/public-api'
import type { PortalDraftSaveOutcome } from '../portal-editor/portal-draft-autosave'
import { sameFocal, type FocalPoint } from '../property-look/focal-point'
import type { ColoursDraft } from '../property-look/property-look-colours-section'
import {
  coloursAreUnchanged,
  coloursInputOf,
  coloursProblemOf,
  focalInputOf,
  wordmarkInputOf,
  wordmarkProblemOf,
} from './portal-look-rules'
import type { PortalLookTarget } from './portal-look-types'

/** One autosaved write: the draft against what the server holds, and what it holds afterwards. */
export type PortalLookSave<T> = (
  draft: T,
  saved: T,
) => Promise<Readonly<{ outcome: PortalDraftSaveOutcome; saved: T }>>

type Send<Input> = (args: { data: Input }) => Promise<unknown>

export const saveColoursDraft =
  (
    target: PortalLookTarget,
    send: Send<PortalLookColoursInput>,
  ): PortalLookSave<ColoursDraft> =>
  async (draft, saved) => {
    if (coloursAreUnchanged(saved, draft)) return { outcome: 'unchanged', saved }
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
    if (saved.trim() === draft.trim()) return { outcome: 'unchanged', saved }
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
    if (sameFocal(saved, draft)) return { outcome: 'unchanged', saved }
    await send({ data: focalInputOf(target, draft) })
    return { outcome: 'saved', saved: draft }
  }

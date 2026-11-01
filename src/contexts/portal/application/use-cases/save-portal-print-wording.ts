// Portal context — saves the wording of the final print kit (2026-10-27).
//
// "Save wording" in Share: the call to action the manager picked and the words
// they wrote, kept per Portal so Share opens on them next time. It needs the same
// right as a download (`portal.update`) and the final kit on, and refuses what a
// download refuses of the words themselves: an offer for the review (the input's
// own rules, which the download shares, have already held the fields to a
// headline on one line of at most 60 characters). It does not judge whether the
// words fit a print: fit depends on the print, and a download judges it. Unlike
// the last print's memory, a failure is the manager's to hear of: they asked.

import type { AuthContext } from '#/shared/domain/auth-context'
import { assertPersonalPortalPublicText } from '../../domain/personal-portal-public-text'
import { portalId } from '#/shared/domain/ids'
import { printFinalWordsOffer } from '#/shared/domain/portal-print-final-warnings'
import {
  printFinalWordingToSave,
  type PrintFinalSavedWording,
} from '#/shared/domain/portal-print-final-wording'
import { PRINT_FINAL_REFUSAL_COPY } from '#/shared/domain/portal-print-final-refusals'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalError } from '../../domain/errors'
import type { SavePortalPrintWordingInput } from '../dto/portal-print-wording.dto'
import { loadPortalOrThrow } from '../load-accessible-portal'
import type { PortalPrintWordingRepository } from '../ports/portal-print-wording.repository'
import type { PortalRepository } from '../ports/portal.repository'

export type SavePortalPrintWordingDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  wordingRepo: Pick<PortalPrintWordingRepository, 'save'>
  clock: () => Date
  /** PRINT_KIT_FINAL_ENABLED: off, every save is refused as the download is. */
  finalKitEnabled: boolean
}>

export const savePortalPrintWording =
  (deps: SavePortalPrintWordingDeps) =>
  async (
    input: SavePortalPrintWordingInput,
    ctx: AuthContext,
  ): Promise<PrintFinalSavedWording> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.update',
      forbiddenMessage: 'Insufficient permissions to save the print wording',
    })
    if (!deps.finalKitEnabled) {
      throw portalError('print_format_not_offered', 'This print is not available yet.')
    }
    const words = { preset: input.callToAction, custom: input.customWords ?? null }
    assertPersonalPortalPublicText(portal, input.customWords)
    // Judged in the languages the words are written in: the save names no print.
    const languages = Object.keys(input.customWords ?? {}) as GuestLocale[]
    if (printFinalWordsOffer(words, languages)) {
      throw portalError(
        'print_format_not_offered',
        PRINT_FINAL_REFUSAL_COPY.remove_offer,
        {
          cause: 'remove_offer',
        },
      )
    }
    // Own words only where they differ from the wording's copy: fields left as prefilled are the wording.
    const wording = printFinalWordingToSave(words, languages)
    await deps.wordingRepo.save({
      organizationId: ctx.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      wording,
      savedAt: deps.clock(),
    })
    return wording
  }

export type SavePortalPrintWording = ReturnType<typeof savePortalPrintWording>

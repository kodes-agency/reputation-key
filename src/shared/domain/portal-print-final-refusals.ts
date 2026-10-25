// Why a final print is refused, in words a manager can act on (final design
// spec §9 and §12 "Choices and refusals"). The server says these when it refuses
// a download, and the Share tab says the same where it holds a choice back, so
// the two never disagree.

import type { PrintFinalRefusal } from './portal-print-final-offer'

export const PRINT_FINAL_REFUSAL_COPY: Readonly<
  Record<PrintFinalRefusal['code'], string>
> = Object.freeze({
  needs_short_code:
    'Replace the code to print tents and Small cards. Counter cards print with the code you have.',
  address_host_too_long:
    'This piece cannot print from this server yet. Counter cards can.',
  tile_does_not_fit: 'A wide Small card has no room for this code. Print it upright.',
  cue_does_not_fit:
    'The scan line in these two languages does not fit this piece. Choose one language.',
  tents_office_only:
    'Print shops sell tents from 4 × 6 in, so for a shop choose Counter cards.',
  no_back_for_tents:
    'Tents print the front on both faces, so they have no back page. Choose a card for one.',
  quantity_out_of_range: 'Enter how many you need, from 1 to 1000.',
  per_sheet_out_of_range: 'Choose how many go on a sheet, up to as many as fit.',
  languages_out_of_range: 'Choose one or two languages.',
})

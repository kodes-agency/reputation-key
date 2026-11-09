import { z } from 'zod/v4'

const connectionIdSchema = z.uuid()
const opaqueReferenceSchema = z.string().min(1).max(512)

export const listImportAccountsInputSchema = z
  .object({
    connectionId: connectionIdSchema,
    cursorRef: opaqueReferenceSchema.optional(),
  })
  .strict()

export const listImportCandidatesInputSchema = z
  .object({
    connectionId: connectionIdSchema,
    accountRef: opaqueReferenceSchema.optional(),
    cursorRef: opaqueReferenceSchema.optional(),
  })
  .strict()
  .refine(
    (value) => (value.accountRef === undefined) !== (value.cursorRef === undefined),
    {
      message: 'Provide exactly one account or cursor reference',
    },
  )

export type ListImportAccountsInput = z.infer<typeof listImportAccountsInputSchema>
export type ListImportCandidatesInput = z.infer<typeof listImportCandidatesInputSchema>

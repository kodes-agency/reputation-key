// A fact whose type no registered event schema knows: committing it through the
// outbox fails, which lets a test prove the surrounding command rolls back.
export const unregisteredFact = <TFact extends { readonly _tag: string }>(
  fact: TFact,
  tag: string,
): TFact => ({ ...fact, _tag: tag }) as unknown as TFact

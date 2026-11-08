export type DataFateDisposition =
  | 'active_authority'
  | 'compatibility_read'
  | 'quarantined_reconciliation_input'
  | 'erasable_source_content'
  | 'recoverable_archive'
  | 'bounded_contraction'

export type DataFateOwner =
  | 'ai'
  | 'feed'
  | 'guest'
  | 'identity'
  | 'inbox'
  | 'integration'
  | 'platform'
  | 'portal'
  | 'property'
  | 'reporting'
  | 'review'

export type DataFateRow = Readonly<{
  schemaFile: string
  exportName: string
  owner: DataFateOwner
  disposition: DataFateDisposition
  /** Package or accepted authority responsible for this decision. */
  authority: string
  /**
   * Required for every non-active row; names the condition that bounds it. An
   * active row states one when its rows have a lifecycle worth recording here.
   */
  exitCriteria: string
}>

export type DataFateGroup = Readonly<{
  schemaFile: string
  exportNames: ReadonlyArray<string>
  owner: DataFateOwner
  disposition: DataFateDisposition
  authority: string
  exitCriteria?: string
}>

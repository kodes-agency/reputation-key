// Keeps the triage board in step with the triage labels.
//
// The board is GitHub Project #1 of the kodes-agency user, "Reputation Key"
// (docs/agents/issue-tracker.md). A board's columns come from a single-select
// field, never from labels, so its built-in Status field carries the five
// triage label names as options. Nothing in GitHub copies a label into that
// field: until this script a relabelled issue kept its old column and a new
// issue never reached the board. The triage-board workflow runs it on every
// issue event that can change either.
//
// It reads the issue's labels fresh instead of from the event. `gh issue edit
// --add-label … --remove-label …` sends two events at once, and whichever run
// goes last must see the final set, not the set its own event described.
//
// A closed issue is left alone: the board shows open issues only. An issue with
// two triage labels goes to the column furthest along the lifecycle, and the run
// warns about the other label, because the usual cause is a `needs-triage`
// nobody removed. A board with no option for a label fails the run before it
// changes anything: the options and docs/agents/triage-labels.md have drifted.
//
// The workflow's own GITHUB_TOKEN cannot write a user's project, so the run
// needs TRIAGE_BOARD_TOKEN: a classic personal access token with the `project`
// scope and nothing else.

import { isEntryPoint } from './entry-point.ts'

/** Furthest along the triage lifecycle first: the label that wins a tie. */
export const TRIAGE_LABELS = [
  'wontfix',
  'ready-for-human',
  'ready-for-agent',
  'needs-info',
  'needs-triage',
] as const

const COLUMN_FIELD = 'Status'
const GRAPHQL_URL = 'https://api.github.com/graphql'
const UNAUTHORIZED = 401
// Well past a normal answer; the job's 5-minute timeout is the outer bound.
const REQUEST_TIMEOUT_MS = 30_000
const POSITIVE_WHOLE_NUMBER = /^[1-9]\d*$/u

export type GraphQL = (
  query: string,
  variables: Readonly<Record<string, unknown>>,
) => Promise<unknown>

export type BoardTarget = Readonly<{
  owner: string
  projectNumber: number
  issueId: string
}>

export type TriageColumn = Readonly<{
  /** The label whose column the issue belongs in; null for "No Status". */
  column: string | null
  /** Triage labels the issue also carries, which lost the tie. */
  ignored: readonly string[]
}>

export type SyncResult = TriageColumn &
  Readonly<{ issue: number; outcome: 'placed' | 'left-closed' }>

type Option = Readonly<{ id: string; name: string }>
type Board = Readonly<{ id: string; fieldId: string; options: readonly Option[] }>
type IssueState = Readonly<{ number: number; state: string; labels: readonly string[] }>

type LookupAnswer = Readonly<{
  repositoryOwner: {
    projectV2?: { id: string; field: { id?: string; options?: Option[] } | null } | null
  } | null
  node: { number?: number; state?: string; labels?: { nodes: { name: string }[] } } | null
}>

const LOOKUP = `query TriageBoardLookup($owner: String!, $number: Int!, $issue: ID!) {
  repositoryOwner(login: $owner) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        id
        field(name: "${COLUMN_FIELD}") {
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
      }
    }
  }
  node(id: $issue) {
    ... on Issue { number state labels(first: 100) { nodes { name } } }
  }
}`

const ADD_ITEM = `mutation AddToTriageBoard($project: ID!, $issue: ID!) {
  addProjectV2ItemById(input: { projectId: $project, contentId: $issue }) { item { id } }
}`

const SET_COLUMN = `mutation SetTriageColumn($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }
  ) { projectV2Item { id } }
}`

const CLEAR_COLUMN = `mutation ClearTriageColumn($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) {
    projectV2Item { id }
  }
}`

/** The column an issue with these labels belongs in. */
export function pickTriageColumn(labels: readonly string[]): TriageColumn {
  const present = TRIAGE_LABELS.filter((label) => labels.includes(label))
  return { column: present[0] ?? null, ignored: present.slice(1) }
}

function readBoard(answer: LookupAnswer, target: BoardTarget): Board {
  const project = answer.repositoryOwner?.projectV2
  const name = `project #${target.projectNumber}`
  if (!project) throw new Error(`${target.owner} has no ${name}`)
  const { id: fieldId, options } = project.field ?? {}
  if (!fieldId || !options)
    throw new Error(`${name} has no single-select ${COLUMN_FIELD} field`)
  return { id: project.id, fieldId, options }
}

function readIssue(answer: LookupAnswer, issueId: string): IssueState {
  const { number, state, labels } = answer.node ?? {}
  if (number === undefined || state === undefined || !labels) {
    throw new Error(`${issueId} is not an issue`)
  }
  return { number, state, labels: labels.nodes.map(({ name }) => name) }
}

function optionFor(board: Board, column: string, target: BoardTarget): Option {
  const option = board.options.find(({ name }) => name === column)
  if (option) return option
  throw new Error(
    `project #${target.projectNumber} has no "${column}" option in its ${COLUMN_FIELD} field; ` +
      'its options must match the labels in docs/agents/triage-labels.md',
  )
}

async function addItem(graphql: GraphQL, board: Board, issueId: string): Promise<string> {
  const answer = (await graphql(ADD_ITEM, { project: board.id, issue: issueId })) as {
    addProjectV2ItemById?: { item?: { id?: string } }
  }
  const item = answer.addProjectV2ItemById?.item?.id
  if (!item) throw new Error(`GitHub added ${issueId} to the board but returned no item`)
  return item
}

/** Adds the issue to the board when it is open and moves its card to the column its labels name. */
export async function syncIssue(
  graphql: GraphQL,
  target: BoardTarget,
): Promise<SyncResult> {
  const answer = (await graphql(LOOKUP, {
    owner: target.owner,
    number: target.projectNumber,
    issue: target.issueId,
  })) as LookupAnswer
  const board = readBoard(answer, target)
  const issue = readIssue(answer, target.issueId)
  if (issue.state !== 'OPEN') {
    return { issue: issue.number, outcome: 'left-closed', column: null, ignored: [] }
  }
  const { column, ignored } = pickTriageColumn(issue.labels)
  const option = column === null ? null : optionFor(board, column, target)
  const item = await addItem(graphql, board, target.issueId)
  const card = { project: board.id, item, field: board.fieldId }
  await (option === null
    ? graphql(CLEAR_COLUMN, card)
    : graphql(SET_COLUMN, { ...card, option: option.id }))
  return { issue: issue.number, outcome: 'placed', column, ignored }
}

function required(env: NodeJS.ProcessEnv, name: string, hint = ''): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is empty${hint}`)
  return value
}

export function readConfig(
  env: NodeJS.ProcessEnv,
): Readonly<{ token: string; target: BoardTarget }> {
  const token = required(
    env,
    'TRIAGE_BOARD_TOKEN',
    ': add the repository secret, a classic personal access token with only the `project` scope',
  )
  const number = required(env, 'TRIAGE_BOARD_NUMBER')
  if (!POSITIVE_WHOLE_NUMBER.test(number)) {
    throw new Error(`TRIAGE_BOARD_NUMBER must be a project number, got "${number}"`)
  }
  return {
    token,
    target: {
      owner: required(env, 'TRIAGE_BOARD_OWNER'),
      projectNumber: Number(number),
      issueId: required(env, 'ISSUE_NODE_ID'),
    },
  }
}

type GraphQLBody = Readonly<{ data?: unknown; errors?: readonly { message: string }[] }>

export function createGraphQL(token: string, fetchImpl: typeof fetch = fetch): GraphQL {
  return async (query, variables) => {
    const response = await fetchImpl(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'reputation-key-triage-board',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      const hint =
        response.status === UNAUTHORIZED ? '; check the TRIAGE_BOARD_TOKEN secret' : ''
      throw new Error(`GitHub GraphQL answered ${response.status}${hint}`)
    }
    const body = (await response.json()) as GraphQLBody
    if (body.errors?.length) {
      throw new Error(
        `GitHub GraphQL: ${body.errors.map(({ message }) => message).join('; ')}`,
      )
    }
    if (body.data == null) throw new Error('GitHub GraphQL answered without data')
    return body.data
  }
}

/** The lines the run prints; a lost tie is a workflow warning. */
export function report(result: SyncResult): readonly string[] {
  if (result.outcome === 'left-closed')
    return [`#${result.issue} is closed; the board shows open issues only`]
  const column = result.column ?? 'No Status'
  return [
    `#${result.issue} is in the "${column}" column`,
    ...result.ignored.map(
      (label) =>
        `::warning::#${result.issue} also carries "${label}", which lost to "${column}"; remove the label that no longer applies`,
    ),
  ]
}

async function main(): Promise<number> {
  try {
    const { token, target } = readConfig(process.env)
    const result = await syncIssue(createGraphQL(token), target)
    for (const line of report(result)) console.log(line)
    return 0
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main()
}

import { describe, expect, it } from 'vitest'
import {
  createGraphQL,
  pickTriageColumn,
  readConfig,
  report,
  syncIssue,
  type GraphQL,
} from './sync-triage-board.ts'

const TARGET = { owner: 'kodes-agency', projectNumber: 1, issueId: 'I_issue' }

const OPTIONS = [
  { id: 'opt-triage', name: 'needs-triage' },
  { id: 'opt-info', name: 'needs-info' },
  { id: 'opt-agent', name: 'ready-for-agent' },
  { id: 'opt-human', name: 'ready-for-human' },
  { id: 'opt-wontfix', name: 'wontfix' },
]

type Issue = Readonly<{ state: string; labels: readonly string[] }>
type Call = Readonly<{ operation: string; variables: Readonly<Record<string, unknown>> }>

function lookupAnswer(issue: Issue | null, options = OPTIONS): unknown {
  return {
    repositoryOwner: {
      projectV2: {
        id: 'PVT_board',
        field: { id: 'PVTSSF_status', options },
      },
    },
    node: issue && {
      number: 42,
      state: issue.state,
      labels: { nodes: issue.labels.map((name) => ({ name })) },
    },
  }
}

/** A GitHub that answers the lookup with `lookup` and records every call. */
function fakeGitHub(lookup: unknown): { graphql: GraphQL; calls: Call[] } {
  const calls: Call[] = []
  const graphql: GraphQL = async (query, variables) => {
    const operation = /(?:query|mutation)\s+(\w+)/u.exec(query)?.[1] ?? 'unnamed'
    calls.push({ operation, variables })
    if (operation === 'TriageBoardLookup') return lookup
    if (operation === 'AddToTriageBoard')
      return { addProjectV2ItemById: { item: { id: 'PVTI_item' } } }
    return {}
  }
  return { graphql, calls }
}

const operations = (calls: readonly Call[]): readonly string[] =>
  calls.map(({ operation }) => operation)

describe('pickTriageColumn', () => {
  it('puts an issue with no triage label in no column', () => {
    expect(pickTriageColumn(['bug', 'wayfinder:map'])).toEqual({
      column: null,
      ignored: [],
    })
  })

  it('puts an issue in the column of its one triage label', () => {
    expect(pickTriageColumn(['bug', 'needs-info'])).toEqual({
      column: 'needs-info',
      ignored: [],
    })
  })

  it('lets the label furthest along the lifecycle win and names the rest', () => {
    expect(pickTriageColumn(['needs-triage', 'ready-for-agent'])).toEqual({
      column: 'ready-for-agent',
      ignored: ['needs-triage'],
    })
    expect(pickTriageColumn(['ready-for-agent', 'wontfix', 'needs-info'])).toEqual({
      column: 'wontfix',
      ignored: ['ready-for-agent', 'needs-info'],
    })
  })
})

describe('syncIssue', () => {
  it('adds an open issue to the board and sets the column of its triage label', async () => {
    const github = fakeGitHub(
      lookupAnswer({ state: 'OPEN', labels: ['ready-for-agent'] }),
    )

    const result = await syncIssue(github.graphql, TARGET)

    expect(result).toEqual({
      issue: 42,
      outcome: 'placed',
      column: 'ready-for-agent',
      ignored: [],
    })
    expect(github.calls).toEqual([
      {
        operation: 'TriageBoardLookup',
        variables: { owner: 'kodes-agency', number: 1, issue: 'I_issue' },
      },
      {
        operation: 'AddToTriageBoard',
        variables: { project: 'PVT_board', issue: 'I_issue' },
      },
      {
        operation: 'SetTriageColumn',
        variables: {
          project: 'PVT_board',
          item: 'PVTI_item',
          field: 'PVTSSF_status',
          option: 'opt-agent',
        },
      },
    ])
  })

  it('clears the column of an open issue that lost its triage label', async () => {
    const github = fakeGitHub(lookupAnswer({ state: 'OPEN', labels: ['bug'] }))

    const result = await syncIssue(github.graphql, TARGET)

    expect(result).toEqual({ issue: 42, outcome: 'placed', column: null, ignored: [] })
    expect(github.calls.at(-1)).toEqual({
      operation: 'ClearTriageColumn',
      variables: { project: 'PVT_board', item: 'PVTI_item', field: 'PVTSSF_status' },
    })
  })

  it('reports the triage labels it passed over', async () => {
    const github = fakeGitHub(
      lookupAnswer({ state: 'OPEN', labels: ['needs-triage', 'ready-for-human'] }),
    )

    const result = await syncIssue(github.graphql, TARGET)

    expect(result).toMatchObject({ column: 'ready-for-human', ignored: ['needs-triage'] })
    expect(github.calls.at(-1)?.variables).toMatchObject({ option: 'opt-human' })
  })

  it('leaves a closed issue alone, since the board shows open issues only', async () => {
    const github = fakeGitHub(lookupAnswer({ state: 'CLOSED', labels: ['wontfix'] }))

    const result = await syncIssue(github.graphql, TARGET)

    expect(result).toEqual({
      issue: 42,
      outcome: 'left-closed',
      column: null,
      ignored: [],
    })
    expect(operations(github.calls)).toEqual(['TriageBoardLookup'])
  })

  it('changes nothing when the board has no column for the label', async () => {
    const withoutInfo = OPTIONS.filter(({ name }) => name !== 'needs-info')
    const github = fakeGitHub(
      lookupAnswer({ state: 'OPEN', labels: ['needs-info'] }, withoutInfo),
    )

    await expect(syncIssue(github.graphql, TARGET)).rejects.toThrow(
      /project #1 has no "needs-info" option in its Status field/u,
    )
    expect(operations(github.calls)).toEqual(['TriageBoardLookup'])
  })

  it('names the project when the owner has no such project', async () => {
    const github = fakeGitHub({ repositoryOwner: { projectV2: null }, node: null })

    await expect(syncIssue(github.graphql, TARGET)).rejects.toThrow(
      /kodes-agency has no project #1/u,
    )
  })

  it('refuses a project whose Status field is not a single select', async () => {
    const github = fakeGitHub({
      repositoryOwner: { projectV2: { id: 'PVT_board', field: {} } },
      node: null,
    })

    await expect(syncIssue(github.graphql, TARGET)).rejects.toThrow(
      /project #1 has no single-select Status field/u,
    )
  })

  it('refuses a node that is not an issue', async () => {
    const github = fakeGitHub(lookupAnswer(null))

    await expect(syncIssue(github.graphql, TARGET)).rejects.toThrow(
      /I_issue is not an issue/u,
    )
  })

  it('fails when GitHub adds the issue but returns no item to move', async () => {
    const lookup = lookupAnswer({ state: 'OPEN', labels: ['needs-triage'] })
    const graphql: GraphQL = async (query) =>
      query.includes('TriageBoardLookup') ? lookup : { addProjectV2ItemById: null }

    await expect(syncIssue(graphql, TARGET)).rejects.toThrow(
      /GitHub added I_issue to the board but returned no item/u,
    )
  })
})

describe('report', () => {
  it('names the column the issue landed in', () => {
    expect(
      report({ issue: 7, outcome: 'placed', column: 'needs-info', ignored: [] }),
    ).toEqual(['#7 is in the "needs-info" column'])
    expect(report({ issue: 7, outcome: 'placed', column: null, ignored: [] })).toEqual([
      '#7 is in the "No Status" column',
    ])
  })

  it('warns once for each triage label that lost the tie', () => {
    expect(
      report({
        issue: 7,
        outcome: 'placed',
        column: 'wontfix',
        ignored: ['needs-triage'],
      }),
    ).toEqual([
      '#7 is in the "wontfix" column',
      '::warning::#7 also carries "needs-triage", which lost to "wontfix"; remove the label that no longer applies',
    ])
  })

  it('says why a closed issue was left alone', () => {
    expect(
      report({ issue: 7, outcome: 'left-closed', column: null, ignored: [] }),
    ).toEqual(['#7 is closed; the board shows open issues only'])
  })
})

describe('readConfig', () => {
  const ENV = {
    TRIAGE_BOARD_TOKEN: 'token',
    TRIAGE_BOARD_OWNER: 'kodes-agency',
    TRIAGE_BOARD_NUMBER: '1',
    ISSUE_NODE_ID: 'I_issue',
  }

  it('reads the token and the issue to place', () => {
    expect(readConfig(ENV)).toEqual({ token: 'token', target: TARGET })
  })

  it('says which secret to create when the token is missing', () => {
    expect(() => readConfig({ ...ENV, TRIAGE_BOARD_TOKEN: '' })).toThrow(
      /TRIAGE_BOARD_TOKEN is empty: add the repository secret/u,
    )
  })

  it('refuses a project number that is not a positive whole number', () => {
    expect(() => readConfig({ ...ENV, TRIAGE_BOARD_NUMBER: 'one' })).toThrow(
      /TRIAGE_BOARD_NUMBER must be a project number, got "one"/u,
    )
  })

  it('refuses a run with no issue', () => {
    expect(() => readConfig({ ...ENV, ISSUE_NODE_ID: undefined })).toThrow(
      /ISSUE_NODE_ID is empty/u,
    )
  })
})

describe('createGraphQL', () => {
  const answering =
    (status: number, body: unknown): typeof fetch =>
    async () =>
      new Response(JSON.stringify(body), { status })

  it('sends the query with the token and returns its data', async () => {
    const requests: Request[] = []
    const graphql = createGraphQL('secret-token', async (input, init) => {
      requests.push(new Request(input, init))
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    })

    await expect(graphql('query Q { ok }', { a: 1 })).resolves.toEqual({ ok: true })
    expect(requests[0]?.headers.get('authorization')).toBe('bearer secret-token')
    await expect(requests[0]?.json()).resolves.toEqual({
      query: 'query Q { ok }',
      variables: { a: 1 },
    })
  })

  it('points at the secret when GitHub refuses the token', async () => {
    const graphql = createGraphQL('stale', answering(401, { message: 'Bad credentials' }))

    await expect(graphql('query Q { ok }', {})).rejects.toThrow(
      /answered 401.*check the TRIAGE_BOARD_TOKEN secret/u,
    )
  })

  it('fails on GraphQL errors even when the answer is 200', async () => {
    const graphql = createGraphQL(
      'token',
      answering(200, {
        data: null,
        errors: [{ message: 'Could not resolve to a ProjectV2' }],
      }),
    )

    await expect(graphql('query Q { ok }', {})).rejects.toThrow(
      /GitHub GraphQL: Could not resolve to a ProjectV2/u,
    )
  })

  it('fails on a 200 answer that carries no data', async () => {
    const graphql = createGraphQL('token', answering(200, { data: null }))

    await expect(graphql('query Q { ok }', {})).rejects.toThrow(
      /GitHub GraphQL answered without data/u,
    )
  })
})

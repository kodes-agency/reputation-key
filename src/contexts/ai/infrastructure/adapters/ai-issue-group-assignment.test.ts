import { describe, expect, it } from 'vitest'
import { normalizeIssueThing } from '#/shared/property-issue-normalization'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import {
  planIssueGroupAssignments,
  type IssueAssignmentGroup,
  type IssueAssignmentMember,
  type IssueAssignmentMention,
} from './ai-issue-group-assignment'

const AIR_GROUP = '00000000-0000-4000-8000-000000000101'
const NEW_GROUP = '00000000-0000-4000-8000-000000000102'
const TARGET_GROUP = '00000000-0000-4000-8000-000000000103'

function mention(
  ordinal: number,
  topic: ReviewTopicV3,
  thing: string | null,
  candidateGroupId = NEW_GROUP,
): IssueAssignmentMention {
  return {
    mentionOrdinal: ordinal,
    topic,
    normalized: normalizeIssueThing(topic, thing),
    candidateGroupId,
  }
}

function group(
  id: string,
  canonicalKey: string,
  mergedIntoIssueId: string | null = null,
  topic: ReviewTopicV3 = 'facilities_equipment',
): IssueAssignmentGroup {
  return {
    id,
    topic,
    canonicalKey,
    canonicalThing: canonicalKey === '__topic__' ? null : canonicalKey,
    mergedIntoIssueId,
  }
}

function member(
  memberKey: string,
  issueGroupId = AIR_GROUP,
  topic: ReviewTopicV3 = 'facilities_equipment',
): IssueAssignmentMember {
  return { memberKey, issueGroupId, topic }
}

describe('property issue assignment planner', () => {
  it('uses a stored member before the current normalization catalogue', () => {
    const plan = planIssueGroupAssignments({
      mentions: [mention(0, 'facilities_equipment', 'ac')],
      groups: [group(AIR_GROUP, 'cooling unit')],
      members: [member('ac')],
    })

    expect(plan.assignments).toEqual([{ mentionOrdinal: 0, issueGroupId: AIR_GROUP }])
    expect(plan.groupsToInsert).toEqual([])
    expect(plan.membersToInsert).toEqual([])
  })

  it('adds a new observed spelling to an existing canonical group', () => {
    const plan = planIssueGroupAssignments({
      mentions: [mention(1, 'facilities_equipment', 'air con')],
      groups: [group(AIR_GROUP, 'air conditioning')],
      members: [],
    })

    expect(plan.assignments).toEqual([{ mentionOrdinal: 1, issueGroupId: AIR_GROUP }])
    expect(plan.groupsToInsert).toEqual([])
    expect(plan.membersToInsert).toEqual([
      {
        issueGroupId: AIR_GROUP,
        topic: 'facilities_equipment',
        memberKey: 'air con',
        memberThing: 'air con',
      },
      {
        issueGroupId: AIR_GROUP,
        topic: 'facilities_equipment',
        memberKey: 'air conditioning',
        memberThing: 'air conditioning',
      },
    ])
  })

  it('follows a merged canonical group by one hop', () => {
    const plan = planIssueGroupAssignments({
      mentions: [mention(0, 'facilities_equipment', 'ac')],
      groups: [
        group(AIR_GROUP, 'air conditioning', TARGET_GROUP),
        group(TARGET_GROUP, 'climate control'),
      ],
      members: [],
    })

    expect(plan.assignments).toEqual([{ mentionOrdinal: 0, issueGroupId: TARGET_GROUP }])
    expect(plan.membersToInsert[0]).toMatchObject({ issueGroupId: TARGET_GROUP })
  })

  it('plans one stable group and its canonical member for a new spelling', () => {
    const plan = planIssueGroupAssignments({
      mentions: [mention(0, 'facilities_equipment', 'ac')],
      groups: [],
      members: [],
    })

    expect(plan.groupsToInsert).toEqual([
      {
        id: NEW_GROUP,
        topic: 'facilities_equipment',
        canonicalKey: 'air conditioning',
        canonicalThing: 'air conditioning',
      },
    ])
    expect(plan.membersToInsert.map(({ memberKey }) => memberKey)).toEqual([
      'ac',
      'air conditioning',
    ])
  })

  it('plans the topic-level sentinel without a thing', () => {
    const plan = planIssueGroupAssignments({
      mentions: [mention(0, 'cleanliness', null)],
      groups: [],
      members: [],
    })

    expect(plan.groupsToInsert[0]).toMatchObject({
      topic: 'cleanliness',
      canonicalKey: '__topic__',
      canonicalThing: null,
    })
    expect(plan.membersToInsert[0]).toMatchObject({
      memberKey: '__topic__',
      memberThing: null,
    })
  })

  it('puts two spellings from one analysis under one group', () => {
    const plan = planIssueGroupAssignments({
      mentions: [
        mention(0, 'facilities_equipment', 'ac'),
        mention(1, 'facilities_equipment', 'air con'),
      ],
      groups: [],
      members: [],
    })

    expect(plan.groupsToInsert).toHaveLength(1)
    expect(plan.assignments).toEqual([
      { mentionOrdinal: 0, issueGroupId: NEW_GROUP },
      { mentionOrdinal: 1, issueGroupId: NEW_GROUP },
    ])
    expect(plan.membersToInsert.map(({ memberKey }) => memberKey)).toEqual([
      'ac',
      'air conditioning',
      'air con',
    ])
  })

  it('is idempotent when re-planned from the rows the first plan creates', () => {
    const mentions = [mention(0, 'facilities_equipment', 'ac')]
    const first = planIssueGroupAssignments({ mentions, groups: [], members: [] })
    const second = planIssueGroupAssignments({
      mentions,
      groups: first.groupsToInsert.map((row) => ({
        ...row,
        mergedIntoIssueId: null,
      })),
      members: first.membersToInsert,
    })

    expect(second.assignments).toEqual(first.assignments)
    expect(second.groupsToInsert).toEqual([])
    expect(second.membersToInsert).toEqual([])
  })
})

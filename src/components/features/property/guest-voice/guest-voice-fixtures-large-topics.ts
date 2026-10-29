// The twelve rows of "Every topic" for the hotel: reviews that praise, complain and say
// neither, their stars, and what the topic had in the 12 months before the window.
import type { ReviewTopicV3, TopicRow } from '#/contexts/ai/application/public-api'
import {
  issueStatistics,
  type StarCounts,
  type WindowFacts,
} from '#/contexts/ai/application/read-models/issue-statistics'

/** One row of "Every topic": reviews that praise, complain and say neither, and their stars. */
type TopicSpec = Readonly<{
  topic: ReviewTopicV3
  praise: number
  complaints: number
  neutral: number
  stars: StarCounts
  /** Reviews that named it in the 12 months before the window. */
  before: number
}>

const TOPIC_SPECS: readonly TopicSpec[] = [
  {
    topic: 'staff_service',
    praise: 92,
    complaints: 8,
    neutral: 0,
    stars: [2, 2, 4, 26, 66],
    before: 375,
  },
  {
    topic: 'main_service',
    praise: 31,
    complaints: 21,
    neutral: 0,
    stars: [4, 6, 8, 16, 18],
    before: 195,
  },
  {
    topic: 'location_access',
    praise: 40,
    complaints: 0,
    neutral: 0,
    stars: [0, 0, 2, 12, 26],
    before: 150,
  },
  {
    topic: 'food_drink',
    praise: 31,
    complaints: 4,
    neutral: 0,
    stars: [0, 2, 3, 10, 20],
    before: 131,
  },
  {
    topic: 'cleanliness',
    praise: 6,
    complaints: 21,
    neutral: 0,
    stars: [5, 5, 7, 7, 3],
    before: 101,
  },
  {
    topic: 'facilities_equipment',
    praise: 3,
    complaints: 19,
    neutral: 0,
    stars: [7, 6, 5, 3, 1],
    before: 41,
  },
  {
    topic: 'atmosphere_noise',
    praise: 18,
    complaints: 6,
    neutral: 0,
    stars: [1, 2, 3, 6, 12],
    before: 90,
  },
  {
    topic: 'speed_waiting',
    praise: 4,
    complaints: 13,
    neutral: 0,
    stars: [2, 3, 4, 5, 3],
    before: 110,
  },
  {
    topic: 'booking_arrival',
    praise: 11,
    complaints: 4,
    neutral: 0,
    stars: [1, 1, 2, 4, 7],
    before: 56,
  },
  {
    topic: 'price_billing',
    praise: 9,
    complaints: 3,
    neutral: 0,
    stars: [1, 2, 1, 3, 5],
    before: 45,
  },
  {
    topic: 'communication',
    praise: 3,
    complaints: 3,
    neutral: 0,
    stars: [1, 1, 1, 1, 2],
    before: 22,
  },
  {
    topic: 'safety',
    praise: 1,
    complaints: 1,
    neutral: 0,
    stars: [1, 0, 0, 0, 1],
    before: 7,
  },
]

export function largeTopicRows(window: WindowFacts): readonly TopicRow[] {
  return TOPIC_SPECS.map((spec) => ({
    topic: spec.topic,
    praiseReviews: spec.praise,
    complaintReviews: spec.complaints,
    neutralReviews: spec.neutral,
    statistics: issueStatistics(window, { stars: spec.stars, before: spec.before }),
  }))
}

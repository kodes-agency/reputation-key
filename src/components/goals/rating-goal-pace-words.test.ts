import { describe, expect, it } from 'vitest'
import {
  paceSentence,
  paceText,
  perWeekText,
  planPaceNote,
  weeklyTarget,
} from './rating-goal-pace-words'

describe('a pace in words', () => {
  it.each([
    [70, '1 a day'],
    [105, '1.5 a day'],
    [140, '2 a day'],
    [355, '5.1 a day'],
    [3500, '50 a day'],
  ])('reads %i tenths a week a day: %s', (tenths, words) => {
    expect(paceText(tenths)).toBe(words)
  })

  it.each([
    [30, '3 a week'],
    [14, '1.4 a week'],
    [10, '1 a week'],
    [69, '6.9 a week'],
  ])('reads a pace under one a day a week: %i is %s', (tenths, words) => {
    expect(paceText(tenths)).toBe(words)
  })

  it.each([
    [70, '30 a month'],
    [46, '20 a month'],
    [30, '13 a month'],
  ])('reads %i tenths a week a month: %s', (tenths, words) => {
    expect(paceText(tenths, 'month')).toBe(words)
  })
})

describe('the weekly count a goal is held to', () => {
  it.each([
    [140, 14],
    [105, 11],
    [14, 1],
    [10, 1],
    [30, 3],
  ])('is %i tenths a week, half up, at least one: %i', (tenths, weekly) => {
    expect(weeklyTarget(tenths)).toBe(weekly)
  })

  it('reads a week with its decimal', () => {
    expect(perWeekText(105)).toBe('10.5 a week')
    expect(perWeekText(140)).toBe('14 a week')
  })
})

describe('a plan’s pace in one sentence', () => {
  it('reads a day, then about a week', () => {
    expect(paceSentence(140)).toBe('2 a day · about 14 a week')
    expect(paceSentence(105)).toBe('1.5 a day · about 11 a week')
  })

  it('reads a week, then about a month, under one a day', () => {
    expect(paceSentence(30)).toBe('3 a week · about 13 a month')
  })

  it('adds the week and the month as a note under the plan', () => {
    expect(planPaceNote(140)).toBe('About 14 a week · 60 a month')
    expect(planPaceNote(30)).toBe('About 13 a month')
  })
})

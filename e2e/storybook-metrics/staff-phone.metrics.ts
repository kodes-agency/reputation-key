import { expect, test } from '@playwright/test'
import { openStory } from './storybook-story'

for (const [width, height, story] of [
  [667, 375, 'landscape-667'],
  [844, 390, 'landscape-844'],
  [915, 412, 'landscape-915'],
] as const) {
  test.describe(`staff Code at ${width} × ${height}`, () => {
    test.use({ viewport: { width, height } })
    test('keeps the entire square above the tabs with no scrolling', async ({ page }) => {
      await openStory(page, `staff-phone-looks--${story}`)
      const code = await page
        .getByRole('img', { name: 'Code for guests to scan' })
        .boundingBox()
      const tabs = await page.getByRole('tablist').boundingBox()
      expect(code).not.toBeNull()
      expect(tabs).not.toBeNull()
      expect(code!.y).toBeGreaterThanOrEqual(0)
      expect(code!.y + code!.height).toBeLessThanOrEqual(tabs!.y)
      expect(code!.width).toBeCloseTo(code!.height, 0)
      expect(code!.width).toBeGreaterThan(200)
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight),
      ).toBeLessThanOrEqual(height)
    })
  })
}

test.describe('staff Code at two Properties on a short phone', () => {
  // An iPhone SE in Safari, with the browser's own bars showing.
  test.use({ viewport: { width: 375, height: 553 } })
  test('keeps the whole square between the Property switch and the tabs', async ({
    page,
  }) => {
    await openStory(page, 'staff-home--two-properties')
    const code = await page
      .getByRole('img', { name: 'Code for guests to scan' })
      .boundingBox()
    const property = await page.getByRole('combobox', { name: 'Property' }).boundingBox()
    const tabs = await page.getByRole('tablist').boundingBox()
    expect(code!.y).toBeGreaterThanOrEqual(property!.y + property!.height)
    expect(code!.y + code!.height).toBeLessThanOrEqual(tabs!.y)
    expect(code!.width).toBeGreaterThan(150)
  })
})

for (const [width, story] of [
  [320, 'code-320'],
  [375, 'code'],
  [768, 'code-768'],
  [1440, 'code-1440'],
] as const) {
  test.describe(`staff home at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    test('fits horizontally and keeps the period control at the touch floor', async ({
      page,
    }) => {
      await openStory(page, `staff-home--${story}`)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width)
      await page.getByRole('tab', { name: 'My results' }).click()
      const period = page.getByRole('combobox', { name: 'Period' })
      await expect(period).toBeVisible()
      if (width < 768) {
        const box = await period.boundingBox()
        expect(box!.height).toBeGreaterThanOrEqual(44)
      }
    })
  })
}

test('keeps the Privacy notice link at the touch floor', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  await openStory(page, 'staff-home--notice-320')
  const link = await page.getByRole('link', { name: 'Privacy notice' }).boundingBox()
  expect(link!.height).toBeGreaterThanOrEqual(44)
})

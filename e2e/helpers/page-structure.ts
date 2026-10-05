// A page's outline, asserted in the real app (UI consistency scan: FRAME-10, FORM-10).
//
// The source guard in src/components/ui/heading-sources.test.ts keeps a second
// `<h1>` out of the sources, but it cannot see which components a route puts on
// one screen: the Inbox lost its heading on a phone and an Organization page
// drew the name beside its header, each time with the sources "clean". Axe's
// `page-has-heading-one` only asks for at least one, so the count is asserted here.

import { expect, type Page } from '@playwright/test'

/**
 * Fails unless the page has exactly one `<h1>`. Call it after the page's own
 * content assertion has passed, at desktop size: `toHaveCount` retries, so a
 * header that renders a moment later is waited for, and a second one fails.
 */
export async function expectOneH1(page: Page): Promise<void> {
  await expect(page.locator('h1')).toHaveCount(1)
}

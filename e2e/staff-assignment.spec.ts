// E2E: Staff assignment to a property

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers/auth";
import {
	createProperty,
	openProperty,
	deleteProperty,
} from "./helpers/property";

test.describe("Staff Assignment", () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page);
	});

	test("assign a staff member to a property", async ({ page }) => {
		const propertyName = await createProperty(page, "E2E Staff");

		// Open the property and go to Staff tab
		await openProperty(page, propertyName);
		await page.getByRole("link", { name: /staff/i }).click();
		await expect(page.getByRole("heading", { name: /staff/i })).toBeVisible();

		// Assign staff
		await page
			.getByRole("combobox")
			.filter({ hasText: /select a staff member/i })
			.click();
		await page.getByRole("option").first().click();
		await page.getByRole("button", { name: /assign staff/i }).click();
		await expect(page.getByRole("button", { name: /unassign/i })).toBeVisible();

		// Cleanup
		await deleteProperty(page, propertyName);
	});
});

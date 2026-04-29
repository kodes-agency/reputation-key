// E2E: Property detail page — view and edit

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers/auth";
import {
	createProperty,
	openProperty,
	deleteProperty,
} from "./helpers/property";

test.describe("Property Detail", () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page);
	});

	test("view property details and edit", async ({ page }) => {
		const propertyName = await createProperty(page, "E2E Detail");

		// Click into the property
		await openProperty(page, propertyName);
		await expect(
			page.getByRole("heading", { name: propertyName }),
		).toBeVisible();

		// Edit the property
		await page.getByRole("button", { name: /edit/i }).click();
		const updatedName = `${propertyName} Edited`;
		await page.getByLabel("Name").fill(updatedName);
		await page.getByRole("button", { name: /save changes/i }).click();
		await expect(
			page.getByRole("heading", { name: updatedName }),
		).toBeVisible();

		// Cleanup
		await deleteProperty(page, updatedName);
	});
});

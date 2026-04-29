// E2E: Team management within a property

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers/auth";
import {
	createProperty,
	openProperty,
	deleteProperty,
} from "./helpers/property";

test.describe("Team Management", () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page);
	});

	test("create a team within a property", async ({ page }) => {
		const propertyName = await createProperty(page, "E2E Team");

		// Open the property and navigate to Teams tab
		await openProperty(page, propertyName);
		await page.getByRole("link", { name: /teams/i }).click();
		await expect(page.getByRole("heading", { name: /teams/i })).toBeVisible();

		// Create a team
		const teamName = `Front Desk ${Date.now()}`;
		await page.getByRole("button", { name: /create team/i }).click();
		await page.getByPlaceholder("Front Desk").fill(teamName);
		await page.getByRole("button", { name: /create team/i }).click();
		await expect(page.getByText(teamName)).toBeVisible();

		// Cleanup
		await deleteProperty(page, propertyName);
	});

	test("edit and delete a team", async ({ page }) => {
		const propertyName = await createProperty(page, "E2E Team Edit");

		// Open the property and go to Teams
		await openProperty(page, propertyName);
		await page.getByRole("link", { name: /teams/i }).click();

		// Create a team
		const teamName = `Housekeeping ${Date.now()}`;
		await page.getByRole("button", { name: /create team/i }).click();
		await page.getByPlaceholder("Front Desk").fill(teamName);
		await page.getByRole("button", { name: /save team/i }).click();
		await expect(page.getByText(teamName)).toBeVisible();

		// Edit the team
		const updatedName = `${teamName} Updated`;
		await page.getByRole("button", { name: /edit/i }).first().click();
		await page.getByPlaceholder("Front Desk").fill(updatedName);
		await page.getByRole("button", { name: /save/i }).click();
		await expect(page.getByText(updatedName)).toBeVisible();

		// Delete the team
		page.on("dialog", (dialog) => dialog.accept());
		await page
			.getByRole("button", { name: /remove/i })
			.first()
			.click();
		await expect(page.getByText(updatedName)).not.toBeVisible();

		// Cleanup
		await deleteProperty(page, propertyName);
	});
});

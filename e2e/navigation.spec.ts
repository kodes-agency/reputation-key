// E2E: Navigation between authenticated pages

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers/auth";
import { createProperty, deleteProperty } from "./helpers/property";

test.describe("Navigation", () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page);
	});

	test("navigate through dashboard, properties, and members", async ({
		page,
	}) => {
		await page.goto("/dashboard");
		await expect(
			page.getByRole("heading", { name: /dashboard/i }),
		).toBeVisible();

		await page.getByRole("link", { name: /properties/i }).click();
		await expect(
			page.getByRole("heading", { name: /properties/i }),
		).toBeVisible();

		await page.getByRole("link", { name: /members/i }).click();
		await expect(page.getByRole("heading", { name: /members/i })).toBeVisible();

		await page.goto("/staff");
		await expect(page.getByRole("heading", { name: /staff/i })).toBeVisible();
	});

	test("property detail tabs navigate correctly", async ({ page }) => {
		const propertyName = await createProperty(page, "E2E Nav");

		// Open property
		await page.getByText(propertyName).click();
		await expect(page.getByText(/property details/i)).toBeVisible();

		// Teams tab
		await page.getByRole("link", { name: /teams/i }).click();
		await expect(page.getByRole("heading", { name: /teams/i })).toBeVisible();

		// Staff tab
		await page.getByRole("link", { name: /staff/i }).click();
		await expect(page.getByRole("heading", { name: /staff/i })).toBeVisible();

		// Cleanup
		await deleteProperty(page, propertyName);
	});
});

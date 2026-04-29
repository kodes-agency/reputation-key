// E2E property helpers — shared property CRUD utilities

import { expect, type Page } from "@playwright/test";

/**
 * Create a property via the UI. Navigates to /properties/new, fills the form,
 * and waits for redirect back to /properties.
 * Returns the property name used.
 */
export async function createProperty(
	page: Page,
	namePrefix = "E2E",
): Promise<string> {
	await page.goto("/properties");
	await page.getByRole("link", { name: /add property/i }).click();
	const propertyName = `${namePrefix} ${Date.now()}`;
	const slug = `e2e-${namePrefix.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
	await page.getByLabel("Name").fill(propertyName);
	await page.getByLabel(/slug/i).fill(slug);
	await page.getByRole("button", { name: /create property/i }).click();
	await page.waitForURL("/properties");
	return propertyName;
}

/**
 * Delete a property by navigating to it and clicking delete.
 * Accepts the confirmation dialog.
 */
export async function deleteProperty(
	page: Page,
	propertyName: string,
): Promise<void> {
	await page.goto("/properties");
	await page.getByText(propertyName).click();
	page.on("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: /delete property/i }).click();
	await page.waitForURL("/properties");
}

/**
 * Navigate into a property from the properties list.
 * Waits for the property detail page to load.
 */
export async function openProperty(
	page: Page,
	propertyName: string,
): Promise<void> {
	await page.goto("/properties");
	await page.getByText(propertyName).click();
	await expect(page.getByText(/property details/i)).toBeVisible();
}

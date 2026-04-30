import { useRouterState } from "@tanstack/react-router";

/**
 * Extract the current propertyId from the URL path.
 * Shared by AppSidebar and AppTopBar.
 */
export function usePropertyId(): string | null {
	return useRouterState({
		select: (s) => {
			const m = s.location.pathname.match(/\/properties\/([^/]+)/);
			return m?.[1] ?? null;
		},
	});
}

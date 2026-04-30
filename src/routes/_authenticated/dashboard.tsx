// Dashboard — redirects to first property overview or shows empty state
import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { listProperties } from "#/contexts/property/server/properties";
import { Button } from "#/components/ui/button";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
	loader: async () => {
		const { properties } = await listProperties();
		if (properties.length > 0) {
			throw redirect({
				to: "/properties/$propertyId",
				params: { propertyId: properties[0].id },
			});
		}
		return { properties };
	},
	component: DashboardPage,
});

function DashboardPage() {
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-24">
			<h2 className="text-lg font-medium">No properties yet</h2>
			<p className="max-w-sm text-center text-sm text-muted-foreground">
				Create your first property to start managing reviews, staff performance,
				and reputation.
			</p>
			<Button asChild>
				<Link to="/properties/new">
					<Plus />
					Create Property
				</Link>
			</Button>
		</div>
	);
}

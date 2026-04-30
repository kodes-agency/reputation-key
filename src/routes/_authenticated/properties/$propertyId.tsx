// Property layout — shared shell for property-scoped routes.
// Child routes render via <Outlet />. Navigation is handled by the sidebar.
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { getProperty } from "#/contexts/property/server/properties";
import { Button } from "#/components/ui/button";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/properties/$propertyId")({
	loader: async ({ params: { propertyId } }) => {
		const res = await getProperty({ data: { propertyId } });
		return { property: res.property };
	},
	component: PropertyLayout,
});

function PropertyLayout() {
	// propertyId available via Route.useParams() if needed
	const navigate = useNavigate();
	const { property } = Route.useLoaderData();

	if (!property) {
		return (
			<div className="flex flex-col items-center gap-4 py-20">
				<Alert variant="destructive" className="max-w-md">
					<AlertCircle />
					<AlertDescription>Property not found.</AlertDescription>
				</Alert>
				<Button
					variant="outline"
					onClick={() => navigate({ to: "/properties" })}
				>
					Back to Properties
				</Button>
			</div>
		);
	}

	return (
		<div className="p-6">
			<Outlet />
		</div>
	);
}

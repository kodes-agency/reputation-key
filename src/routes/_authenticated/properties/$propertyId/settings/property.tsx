// Property settings — view and edit property details with danger zone
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { deleteProperty } from "#/contexts/property/server/properties";
import { PropertyDetailFields } from "#/components/features/property/PropertyDetailFields";
import { useMutationAction } from "#/components/hooks/use-mutation-action";

const parentRoute = getRouteApi("/_authenticated/properties/$propertyId");

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/settings/property",
)({
	component: PropertySettingsPage,
});

function PropertySettingsPage() {
	const { property } = parentRoute.useLoaderData();
	const deleteMutation = useMutationAction(deleteProperty, {
		successMessage: "Property deleted",
		navigateTo: "/properties",
	});

	if (!property) return null;

	return (
		<div className="mx-auto max-w-2xl space-y-8">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">
					Property Settings
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Manage details for {property.name}.
				</p>
			</div>

			<PropertyDetailFields property={property} />

			<div className="space-y-3 rounded-lg border border-destructive/30 p-4">
				<h2 className="text-sm font-semibold text-destructive">Danger Zone</h2>
				<p className="text-sm text-muted-foreground">
					This property will be hidden from your organization. Its data will be
					preserved but it will no longer appear in lists.
				</p>
				<button
					type="button"
					className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-destructive/50 px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
					disabled={deleteMutation.isPending}
					onClick={async () => {
						if (
							!window.confirm(
								`Delete "${property.name}"? This action hides the property from your organization.`,
							)
						)
							return;
						await deleteMutation({ data: { propertyId: property.id } });
					}}
				>
					{deleteMutation.isPending ? "Deleting..." : "Delete Property"}
				</button>
			</div>
		</div>
	);
}

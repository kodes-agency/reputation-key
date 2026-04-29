// Property overview tab — view and edit property details.
// Thin route: reads parent loader data, renders PropertyDetailFields.

import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { PropertyDetailFields } from "#/components/features/property/PropertyDetailFields";

const parentRoute = getRouteApi("/_authenticated/properties/$propertyId");

export const Route = createFileRoute("/_authenticated/properties/$propertyId/")(
	{
		component: PropertyOverview,
	},
);

function PropertyOverview() {
	const { property } = parentRoute.useLoaderData();
	if (!property) return null;
	return <PropertyDetailFields property={property} />;
}

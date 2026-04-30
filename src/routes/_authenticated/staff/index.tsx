// Org-level staff list — aggregates staff assignments across all properties
// Thin route: loader fetches data, component renders OrgStaffTable.

import { createFileRoute } from "@tanstack/react-router";
import { listProperties } from "#/contexts/property/server/properties";
import { listStaffAssignments } from "#/contexts/staff/server/staff-assignments";
import { listMembers } from "#/contexts/identity/server/organizations";
import { OrgStaffTable } from "#/components/features/staff/OrgStaffTable";
import { toMemberOptions } from "#/lib/lookups";

export const Route = createFileRoute("/_authenticated/staff/")({
	loader: async () => {
		const [{ properties }, { members }] = await Promise.all([
			listProperties(),
			listMembers(),
		]);

		const assignments = [];
		if (properties.length > 0) {
			const results = await Promise.all(
				properties.map(async (p: { id: string; name: string }) => {
					const res = await listStaffAssignments({
						data: { propertyId: p.id },
					});
					return res.assignments.map(
						(a: { id: string; userId: string; teamId: string | null }) => ({
							...a,
							propertyName: p.name,
							propertyId: p.id,
						}),
					);
				}),
			);
			assignments.push(...results.flat());
		}

		return { members, assignments };
	},
	component: OrgStaffPage,
});

function OrgStaffPage() {
	const { members, assignments } = Route.useLoaderData();
	const memberOptions = toMemberOptions(members);

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">
					Organization Staff
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					All staff assignments across your properties.
				</p>
			</div>
			<OrgStaffTable assignments={assignments} members={memberOptions} />
		</div>
	);
}

// Staff assignments for a property — list and assign
// Thin route: loader fetches data, component renders feature components.

import { createFileRoute } from "@tanstack/react-router";
import {
	listStaffAssignments,
	createStaffAssignment,
	removeStaffAssignment,
} from "#/contexts/staff/server/staff-assignments";
import { listTeams } from "#/contexts/team/server/teams";
import { listMembers } from "#/contexts/identity/server/organizations";
import { Card, CardContent } from "#/components/ui/card";
import { AssignStaffForm } from "#/components/features/staff/AssignStaffForm";
import { StaffAssignmentList } from "#/components/features/staff/StaffAssignmentList";
import { useMutationAction } from "#/components/hooks/use-mutation-action";
import { toMemberOptions, toTeamOptions } from "#/lib/lookups";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/staff/",
)({
	loader: async ({ params: { propertyId } }) => {
		const [{ assignments }, { members }, { teams }] = await Promise.all([
			listStaffAssignments({ data: { propertyId } }),
			listMembers(),
			listTeams({ data: { propertyId } }),
		]);
		return { assignments, members, teams };
	},
	component: StaffListPage,
});

function StaffListPage() {
	const { propertyId } = Route.useParams();
	const { assignments, members, teams } = Route.useLoaderData();

	const assignMutation = useMutationAction(createStaffAssignment, {
		successMessage: "Staff member assigned",
	});
	const removeMutation = useMutationAction(removeStaffAssignment, {
		successMessage: "Staff member unassigned",
	});

	const memberOptions = toMemberOptions(members);
	const teamOptions = toTeamOptions(teams);

	return (
		<div className="flex flex-col gap-6">
			<h2 className="text-lg font-semibold">Staff</h2>

			<Card>
				<CardContent className="pt-6">
					<h3 className="mb-3 text-sm font-medium">Assign a staff member</h3>
					<AssignStaffForm
						propertyId={propertyId}
						mutation={assignMutation}
						members={memberOptions}
						teams={teamOptions}
					/>
				</CardContent>
			</Card>

			<StaffAssignmentList
				assignments={assignments}
				members={memberOptions}
				teams={teamOptions}
				removeAction={removeMutation}
			/>
		</div>
	);
}

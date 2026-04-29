// Teams within a property — list, create, edit, and manage members
// Thin route: loader fetches data, component renders feature components.

import { createFileRoute } from "@tanstack/react-router";
import {
	listTeams,
	createTeam,
	updateTeam,
	deleteTeam,
} from "#/contexts/team/server/teams";
import {
	listStaffAssignments,
	createStaffAssignment,
	removeStaffAssignment,
} from "#/contexts/staff/server/staff-assignments";
import { listMembers } from "#/contexts/identity/server/organizations";
import { Card, CardContent } from "#/components/ui/card";
import { CreateTeamForm } from "#/components/features/team/CreateTeamForm";
import { TeamCard } from "#/components/features/team/TeamCard";
import { useMutationAction } from "#/components/hooks/use-mutation-action";
import { toMemberOptions } from "#/lib/lookups";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/teams/",
)({
	loader: async ({ params: { propertyId } }) => {
		const [{ teams }, { members }, { assignments }] = await Promise.all([
			listTeams({ data: { propertyId } }),
			listMembers(),
			listStaffAssignments({ data: { propertyId } }),
		]);
		return { teams, members, assignments };
	},
	component: TeamListPage,
});

function TeamListPage() {
	const { propertyId } = Route.useParams();
	const { teams, members, assignments } = Route.useLoaderData();

	// Mutations — one line each instead of 3-5
	const createMutation = useMutationAction(createTeam, {
		successMessage: "Team created",
	});
	const updateMutation = useMutationAction(updateTeam, {
		successMessage: "Team updated",
	});
	const deleteMutation = useMutationAction(deleteTeam, {
		successMessage: "Team removed",
	});
	const addMemberMutation = useMutationAction(createStaffAssignment, {
		successMessage: "Member added to team",
	});
	const removeMemberMutation = useMutationAction(removeStaffAssignment, {
		successMessage: "Member removed from team",
	});

	const memberOptions = toMemberOptions(members);

	return (
		<div className="flex flex-col gap-6">
			<h2 className="text-lg font-semibold">Teams</h2>

			<Card>
				<CardContent className="pt-6">
					<h3 className="mb-3 text-sm font-medium">Create a new team</h3>
					<CreateTeamForm
						propertyId={propertyId}
						mutation={createMutation}
						members={memberOptions}
					/>
				</CardContent>
			</Card>

			{teams.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No teams yet. Create one above to group staff.
				</p>
			) : (
				<div className="flex flex-col gap-2">
					{teams.map(
						(team: {
							id: string;
							name: string;
							description: string | null;
							teamLeadId: string | null;
						}) => (
							<TeamCard
								key={team.id}
								team={team}
								propertyId={propertyId}
								allAssignments={assignments}
								members={memberOptions}
								updateAction={updateMutation}
								deleteAction={deleteMutation}
								addMemberAction={addMemberMutation}
								removeMemberAction={removeMemberMutation}
							/>
						),
					)}
				</div>
			)}
		</div>
	);
}

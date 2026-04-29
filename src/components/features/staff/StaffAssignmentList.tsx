/**
 * StaffAssignmentList — staff list with member info and unassign buttons.
 * Extracted from property staff route.
 */

import type { MemberLike, TeamLike, AssignmentLike } from "#/lib/lookups";
import { buildMemberLookup, buildTeamLookup } from "#/lib/lookups";
import type { Action } from "#/components/hooks/use-action";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import { UserX } from "lucide-react";

type Props = Readonly<{
	assignments: ReadonlyArray<AssignmentLike>;
	members: ReadonlyArray<MemberLike>;
	teams: ReadonlyArray<TeamLike>;
	removeAction: Action<{ data: { assignmentId: string } }>;
}>;

export function StaffAssignmentList({
	assignments,
	members,
	teams,
	removeAction,
}: Props) {
	const memberLookup = buildMemberLookup(members);
	const teamLookup = buildTeamLookup(teams);

	if (assignments.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				No staff assigned to this property yet.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			{assignments.map((a) => {
				const member = memberLookup.get(a.userId);
				const teamName = a.teamId ? teamLookup.get(a.teamId) : null;
				return (
					<Card key={a.id}>
						<div className="flex items-center justify-between p-4">
							<div className="flex flex-col gap-1">
								<p className="font-medium">{member ? member.name : a.userId}</p>
								{member && (
									<p className="text-sm text-muted-foreground">
										{member.email}
									</p>
								)}
								{teamName && (
									<Badge variant="secondary" className="w-fit">
										{teamName}
									</Badge>
								)}
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => removeAction({ data: { assignmentId: a.id } })}
								disabled={removeAction.isPending}
							>
								<UserX />
								Unassign
							</Button>
						</div>
					</Card>
				);
			})}
		</div>
	);
}

/**
 * TeamCard — a single team row with expand/collapse, inline edit mode, and delete.
 * Used in the property teams page.
 */

import { useState } from "react";
import type { Action } from "#/components/hooks/use-action";
import type { MemberLike, AssignmentLike } from "#/lib/lookups";
import { groupAssignmentsByTeam } from "#/lib/lookups";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import { Separator } from "#/components/ui/separator";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { EditTeamForm } from "#/components/features/team/EditTeamForm";
import type { UpdateTeamInput } from "#/contexts/team/application/dto/update-team.dto";
import { TeamMemberList } from "#/components/features/team/TeamMemberList";

// fallow-ignore-next-line unused-type
export interface TeamData {
	id: string;
	name: string;
	description: string | null;
	teamLeadId: string | null;
}

type Props = Readonly<{
	team: TeamData;
	propertyId: string;
	allAssignments: ReadonlyArray<AssignmentLike>;
	members: ReadonlyArray<MemberLike>;
	updateAction: Action<{ data: UpdateTeamInput }>;
	deleteAction: Action<{ data: { teamId: string } }>;
	addMemberAction: Action<{
		data: { userId: string; propertyId: string; teamId: string };
	}>;
	removeMemberAction: Action<{ data: { assignmentId: string } }>;
}>;

function TeamCardHeader({
	team,
	memberCount,
	expanded,
	onToggle,
	onEdit,
	onDelete,
	isDeletePending,
}: {
	team: TeamData;
	memberCount: number;
	expanded: boolean;
	onToggle: () => void;
	onEdit: () => void;
	onDelete: () => void;
	isDeletePending: boolean;
}) {
	return (
		<div className="flex items-center justify-between p-4">
			<div className="flex items-center gap-3">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onToggle}
					aria-label={expanded ? "Collapse team" : "Expand team"}
				>
					<ChevronRight
						className={`transition-transform ${expanded ? "rotate-90" : ""}`}
					/>
				</Button>
				<div>
					<h3 className="flex items-center gap-2 font-medium">
						{team.name}
						<Badge variant="secondary">
							{memberCount} {memberCount === 1 ? "member" : "members"}
						</Badge>
					</h3>
					{team.description && (
						<p className="text-sm text-muted-foreground">{team.description}</p>
					)}
				</div>
			</div>
			<div className="flex gap-2">
				<Button variant="outline" size="sm" onClick={onEdit}>
					<Pencil />
					Edit
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={onDelete}
					disabled={isDeletePending}
				>
					<Trash2 />
					Remove
				</Button>
			</div>
		</div>
	);
}

export function TeamCard({
	team,
	propertyId,
	allAssignments,
	members,
	updateAction,
	deleteAction,
	addMemberAction,
	removeMemberAction,
}: Props) {
	const [editingTeamId, setEditingTeamId] = useState(false);
	const [expanded, setExpanded] = useState(false);

	const assignmentsByTeam = groupAssignmentsByTeam(allAssignments);
	const teamAssignmentIds = assignmentsByTeam.get(team.id) ?? [];
	const teamAssignments = allAssignments.filter((a) => a.teamId === team.id);

	if (editingTeamId) {
		return (
			<Card>
				<CardContent className="pt-6">
					<EditTeamForm
						teamId={team.id}
						initialName={team.name}
						initialDescription={team.description ?? null}
						initialTeamLeadId={team.teamLeadId ?? null}
						members={members.map((m) => ({
							userId: m.userId,
							name: m.name,
							email: m.email,
						}))}
						mutation={updateAction}
						onCancel={() => setEditingTeamId(false)}
					/>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<TeamCardHeader
				team={team}
				memberCount={teamAssignmentIds.length}
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
				onEdit={() => setEditingTeamId(true)}
				onDelete={() => deleteAction({ data: { teamId: team.id } })}
				isDeletePending={deleteAction.isPending}
			/>
			{expanded && (
				<>
					<Separator />
					<TeamMemberList
						teamId={team.id}
						propertyId={propertyId}
						assignments={teamAssignments}
						members={members}
						addAction={addMemberAction}
						removeAction={removeMemberAction}
					/>
				</>
			)}
		</Card>
	);
}

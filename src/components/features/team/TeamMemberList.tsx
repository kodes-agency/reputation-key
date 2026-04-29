/**
 * TeamMemberList — members within an expanded team card.
 * Shows assigned members with remove buttons, and a select to add new members.
 */

import type { Action } from "#/components/hooks/use-action";
import type { MemberLike } from "#/lib/lookups";
import { buildMemberLookup, getAvailableMembers } from "#/lib/lookups";
import { Button } from "#/components/ui/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { UserPlus } from "lucide-react";

interface AssignmentInTeam {
	id: string;
	userId: string;
	teamId: string | null;
}

type Props = Readonly<{
	teamId: string;
	propertyId: string;
	assignments: ReadonlyArray<AssignmentInTeam>;
	members: ReadonlyArray<MemberLike>;
	addAction: Action<{
		data: { userId: string; propertyId: string; teamId: string };
	}>;
	removeAction: Action<{ data: { assignmentId: string } }>;
}>;

export function TeamMemberList({
	teamId,
	propertyId,
	assignments,
	members,
	addAction,
	removeAction,
}: Props) {
	const memberLookup = buildMemberLookup(members);
	const available = getAvailableMembers(members, assignments, teamId);

	return (
		<div className="p-4">
			<h4 className="mb-2 text-sm font-medium">Team members</h4>
			{assignments.length === 0 ? (
				<p className="mb-3 text-sm text-muted-foreground">
					No members in this team yet.
				</p>
			) : (
				<div className="mb-3 flex flex-col gap-1">
					{assignments.map((a) => {
						const member = memberLookup.get(a.userId);
						return (
							<div
								key={a.id}
								className="flex items-center justify-between rounded px-2 py-1"
							>
								<span className="text-sm">
									{member ? `${member.name} — ${member.email}` : a.userId}
								</span>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => removeAction({ data: { assignmentId: a.id } })}
									disabled={removeAction.isPending}
									className="text-muted-foreground hover:text-destructive"
								>
									Remove
								</Button>
							</div>
						);
					})}
				</div>
			)}

			{available.length > 0 ? (
				<div className="flex items-center gap-2">
					<Select
						onValueChange={(userId) => {
							addAction({
								data: { userId, propertyId, teamId },
							});
						}}
						disabled={addAction.isPending}
					>
						<SelectTrigger className="w-[280px]">
							<UserPlus className="text-muted-foreground" />
							<SelectValue placeholder="Add a member…" />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{available.map((m) => (
									<SelectItem key={m.userId} value={m.userId}>
										{m.name} — {m.email}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					All organization members are already in this team.
				</p>
			)}
		</div>
	);
}

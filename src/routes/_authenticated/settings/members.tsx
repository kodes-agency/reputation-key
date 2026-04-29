// Members page — manage organization members, invite, change roles, remove
// Thin route: loader fetches data, component renders feature components.

import { createFileRoute } from "@tanstack/react-router";
import {
	listMembers,
	listInvitations,
	inviteMember,
	updateMemberRole,
	removeMember,
	cancelInvitation,
	resendInvitation,
} from "#/contexts/identity/server/organizations";
import { listProperties } from "#/contexts/property/server/properties";
import type { AuthRouteContext } from "#/routes/_authenticated";
import { can } from "#/shared/domain/permissions";
import { PageShell } from "#/components/layout/PageShell";
import { MemberTable } from "#/components/features/identity/MemberTable";
import { InvitationTable } from "#/components/features/identity/InvitationTable";
import { InviteMemberForm } from "#/components/features/identity/InviteMemberForm";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutationAction } from "#/components/hooks/use-mutation-action";

export const Route = createFileRoute("/_authenticated/settings/members")({
	loader: async () => {
		const [{ properties }, { members }, { invitations }] = await Promise.all([
			listProperties(),
			listMembers(),
			listInvitations(),
		]);
		return { properties, members, invitations };
	},
	component: MembersPage,
});

function MembersPage() {
	const ctx = Route.useRouteContext() as AuthRouteContext;
	const currentUserId = ctx.user.id;
	const role = ctx.role ?? "Staff";
	const canInvite = can(role, "invitation.create");
	const { properties, members, invitations } = Route.useLoaderData();

	const [inviteOpen, setInviteOpen] = useState(false);

	// Mutations — each replaces 3-5 lines of useAction+useServerFn+wrapAction+toast
	const updateRole = useMutationAction(updateMemberRole, {
		successMessage: "Role updated",
	});
	const removeMemberFn = useMutationAction(removeMember, {
		successMessage: "Member removed",
	});
	const inviteMemberFn = useMutationAction(inviteMember, {
		successMessage: "Invitation sent",
		onSuccess: async () => {
			setInviteOpen(false);
		},
	});
	const cancelInvite = useMutationAction(cancelInvitation, {
		successMessage: "Invitation cancelled",
	});
	const resendInvite = useMutationAction(resendInvitation, {
		successMessage: "Invitation email resent",
		invalidate: false,
	});

	const propertyOptions = properties.map((p) => ({ id: p.id, name: p.name }));
	const pendingInvitations = invitations.filter(
		(inv: { status: string }) => inv.status === "pending",
	);

	return (
		<PageShell
			title="Members"
			description="Manage your organization's members, roles, and invitations."
			actions={
				canInvite ? (
					<Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
						<DialogTrigger asChild>
							<Button>
								<UserPlus /> Invite Member
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Invite a new member</DialogTitle>
								<DialogDescription>
									Send an invitation by email. They'll receive a link to join
									your organization.
								</DialogDescription>
							</DialogHeader>
							<InviteMemberForm
								mutation={inviteMemberFn}
								allowedRoles={
									role === "AccountAdmin"
										? (["AccountAdmin", "PropertyManager", "Staff"] as const)
										: (["Staff"] as const)
								}
								properties={propertyOptions}
							/>
						</DialogContent>
					</Dialog>
				) : undefined
			}
		>
			<MemberTable
				members={members}
				currentUserId={currentUserId}
				viewerRole={role}
				updateRoleAction={updateRole}
				removeMemberAction={removeMemberFn}
			/>

			{canInvite && pendingInvitations.length > 0 && (
				<>
					<Separator className="my-6" />
					<InvitationTable
						invitations={pendingInvitations}
						viewerRole={role}
						resendAction={resendInvite}
						cancelAction={cancelInvite}
					/>
				</>
			)}
		</PageShell>
	);
}

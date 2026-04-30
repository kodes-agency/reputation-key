/**
 * InvitationTable — extracted from settings/members.tsx route.
 * Displays pending invitations with resend/cancel actions.
 */

import type { Role } from "#/shared/domain/roles";
import { hasRole } from "#/shared/domain/roles";
import { RoleBadge } from "#/components/features/identity/RoleBadge";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Shield } from "lucide-react";
import type { Action } from "#/components/hooks/use-action";

// fallow-ignore-next-line unused-type
export interface InvitationRow {
	id: string;
	email: string;
	role: Role;
	status: string;
}

type Props = Readonly<{
	invitations: ReadonlyArray<InvitationRow>;
	viewerRole: Role;
	resendAction: Action<{ data: { invitationId: string } }>;
	cancelAction: Action<{ data: { invitationId: string } }>;
}>;

export function InvitationTable({
	invitations,
	viewerRole,
	resendAction,
	cancelAction,
}: Props) {
	const canManage = hasRole(viewerRole, "PropertyManager");

	return (
		<div className="flex flex-col gap-4">
			<h3 className="flex items-center gap-2 text-base font-semibold">
				<Shield />
				Pending Invitations
			</h3>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Email</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Status</TableHead>
						{canManage && <TableHead className="text-right">Actions</TableHead>}
					</TableRow>
				</TableHeader>
				<TableBody>
					{invitations.map((inv) => (
						<TableRow key={inv.id}>
							<TableCell className="font-medium">{inv.email}</TableCell>
							<TableCell>
								<RoleBadge role={inv.role} />
							</TableCell>
							<TableCell>
								<Badge variant="outline">{inv.status}</Badge>
							</TableCell>
							{canManage && inv.status === "pending" && (
								<TableCell className="text-right">
									<div className="flex justify-end gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={resendAction.isPending}
											onClick={() =>
												resendAction({ data: { invitationId: inv.id } })
											}
										>
											Resend
										</Button>
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													variant="outline"
													size="sm"
													className="text-destructive hover:text-destructive"
												>
													Cancel
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>
														Cancel invitation to {inv.email}?
													</AlertDialogTitle>
													<AlertDialogDescription>
														The invitation link will no longer work. You can
														always send a new invitation later.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Keep invitation</AlertDialogCancel>
													<AlertDialogAction
														onClick={() =>
															cancelAction({ data: { invitationId: inv.id } })
														}
														disabled={cancelAction.isPending}
														className="bg-destructive text-white hover:bg-destructive/90"
													>
														{cancelAction.isPending
															? "Cancelling…"
															: "Cancel invitation"}
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									</div>
								</TableCell>
							)}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

/**
 * Shared RoleBadge component and roleLabel helper.
 * Extracted from members.tsx and InviteMemberForm.tsx where they were duplicated.
 */

import type { Role } from "#/shared/domain/roles";
import { Badge } from "#/components/ui/badge";

/** Convert a Role enum value to a human-readable label. */
function roleLabel(role: Role): string {
	switch (role) {
		case "AccountAdmin":
			return "Admin";
		case "PropertyManager":
			return "Manager";
		case "Staff":
			return "Staff";
	}
}

/** Render a role as a Badge with variant matching the role level. */
export function RoleBadge({ role }: Readonly<{ role: Role }>) {
	const variant =
		role === "AccountAdmin"
			? "default"
			: role === "PropertyManager"
				? "secondary"
				: "outline";
	return <Badge variant={variant}>{roleLabel(role)}</Badge>;
}

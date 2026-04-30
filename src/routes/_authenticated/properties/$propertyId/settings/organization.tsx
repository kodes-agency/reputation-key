import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/settings/organization",
)({
	component: OrganizationSettingsPage,
});

function OrganizationSettingsPage() {
	return (
		<div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<Building2 className="size-5 text-muted-foreground" />
			</div>
			<h2 className="text-lg font-medium">Organization Settings</h2>
			<p className="max-w-xs text-sm text-muted-foreground">
				Organization configuration will appear here.
			</p>
		</div>
	);
}

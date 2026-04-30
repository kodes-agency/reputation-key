// Portal editor — main tab with basic info + theme + smart routing
import { createFileRoute, Link } from "@tanstack/react-router";
import { getPortal, updatePortal } from "#/contexts/portal/server/portals";
import { EditPortalForm } from "#/components/features/portal/EditPortalForm";
import { PortalTabNav } from "#/components/features/portal/PortalTabNav";
import { hasRole } from "#/shared/domain/roles";
import { Button } from "#/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useMutationAction } from "#/components/hooks/use-mutation-action";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/portals/$portalId/",
)({
	loader: async ({ params }) => {
		const { portal } = await getPortal({
			data: { portalId: params.portalId },
		});
		return {
			portal,
			propertyId: params.propertyId,
			portalId: params.portalId,
		};
	},
	component: PortalEditorPage,
});

function PortalEditorPage() {
	const ctx = Route.useRouteContext();
	const { portal, propertyId, portalId } = Route.useLoaderData();
	const canEdit = hasRole(ctx.role, "PropertyManager");

	const mutation = useMutationAction(updatePortal, {
		successMessage: "Portal updated",
	});

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<div className="flex items-center gap-2">
				<Button variant="ghost" asChild>
					<Link to="/properties/$propertyId/portals" params={{ propertyId }}>
						<ArrowLeft />
						Back
					</Link>
				</Button>
			</div>

			<PortalTabNav
				propertyId={propertyId}
				portalId={portalId}
				activeTab="settings"
			/>

			<div>
				<h1 className="text-xl font-semibold tracking-tight">
					Portal Settings
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Configure your portal's basic info, theme, and routing.
				</p>
			</div>

			<EditPortalForm portal={portal} mutation={mutation} canEdit={canEdit} />
		</div>
	);
}

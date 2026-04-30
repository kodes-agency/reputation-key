// Portal preview — shows a mock preview of the guest-facing portal
import { createFileRoute, Link } from "@tanstack/react-router";
import { getPortal } from "#/contexts/portal/server/portals";
import { PortalTabNav } from "#/components/features/portal/PortalTabNav";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/portals/$portalId/preview",
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
	component: PortalPreviewPage,
});

function PortalPreviewPage() {
	const { portal, propertyId, portalId } = Route.useLoaderData();

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
				activeTab="preview"
			/>

			{/* Preview frame */}
			<div className="mx-auto max-w-md">
				<Card className="overflow-hidden">
					{/* Hero section */}
					<div
						className="flex h-48 items-end p-6"
						style={{
							backgroundColor: portal.theme.primaryColor,
						}}
					>
						<div>
							<h2 className="text-2xl font-bold text-white">{portal.name}</h2>
							{portal.description && (
								<p className="mt-1 text-sm text-white/80">
									{portal.description}
								</p>
							)}
						</div>
					</div>

					{/* Content area */}
					<CardContent className="p-6">
						<div className="flex flex-col gap-4">
							<p className="text-center text-sm text-muted-foreground">
								Portal preview. Add categories and links in the Links tab.
							</p>

							{portal.smartRoutingEnabled && (
								<div className="rounded-lg border p-3 text-center text-sm">
									<p className="text-muted-foreground">
										Smart Routing: ON (threshold: {portal.smartRoutingThreshold}
										+ stars)
									</p>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

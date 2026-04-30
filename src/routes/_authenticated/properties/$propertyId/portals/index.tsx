// Portal list — shows all portals for a property
import { createFileRoute, Link } from "@tanstack/react-router";
import { listPortals, deletePortal } from "#/contexts/portal/server/portals";
import { hasRole } from "#/shared/domain/roles";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Plus, ChevronRight, Globe, Trash2 } from "lucide-react";
import { useMutationActionSilent } from "#/components/hooks/use-mutation-action";
import { useState } from "react";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/portals/",
)({
	loader: async ({ params }) => {
		const { portals } = await listPortals({
			data: { propertyId: params.propertyId },
		});
		return { portals, propertyId: params.propertyId };
	},
	component: PortalListPage,
});

function PortalListPage() {
	const ctx = Route.useRouteContext();
	const role = ctx.role;
	const canCreate = hasRole(role, "PropertyManager");
	const canDelete = hasRole(role, "PropertyManager");
	const { propertyId } = Route.useParams();
	const { portals: initialPortals } = Route.useLoaderData();
	const [portals, setPortals] = useState(initialPortals);

	const deleteMutation = useMutationActionSilent(deletePortal);

	const handleDelete = async (portalId: string) => {
		if (!confirm("Are you sure you want to delete this portal?")) return;
		try {
			await deleteMutation({ data: { portalId } });
			setPortals((prev) => prev.filter((p) => p.id !== portalId));
		} catch (err) {
			console.error("Failed to delete portal:", err);
		}
	};

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Portals</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Manage guest-facing portal pages for this property.
					</p>
				</div>
				{canCreate && (
					<Button asChild>
						<Link
							to="/properties/$propertyId/portals/new"
							params={{ propertyId }}
						>
							<Plus />
							Add Portal
						</Link>
					</Button>
				)}
			</div>

			{portals.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
					<Globe className="size-8 text-muted-foreground" />
					<p className="text-muted-foreground">No portals yet.</p>
					<p className="text-sm text-muted-foreground">
						Create a portal to set up a guest-facing page with links.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{portals.map((p) => (
						<div key={p.id} className="flex items-center gap-2">
							<Link
								to="/properties/$propertyId/portals/$portalId"
								params={{ propertyId, portalId: p.id }}
								className="flex-1 rounded-lg border p-4 transition-colors hover:bg-accent"
							>
								<div className="flex items-center justify-between">
									<div className="flex flex-col gap-1">
										<p className="font-semibold">{p.name}</p>
										<div className="flex items-center gap-2">
											<Badge variant="secondary">{p.slug}</Badge>
											{p.isActive ? (
												<Badge>Active</Badge>
											) : (
												<Badge variant="outline">Inactive</Badge>
											)}
										</div>
									</div>
									<ChevronRight className="size-4 text-muted-foreground" />
								</div>
							</Link>
							{canDelete && (
								<Button
									size="icon"
									variant="ghost"
									onClick={() => handleDelete(p.id)}
									className="shrink-0"
								>
									<Trash2 className="size-4 text-destructive" />
								</Button>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

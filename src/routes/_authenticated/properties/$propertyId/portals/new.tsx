// Create portal — route defines mutation, renders form component.
import {
	createFileRoute,
	useNavigate,
	Link,
	redirect,
} from "@tanstack/react-router";
import { createPortal } from "#/contexts/portal/server/portals";
import { CreatePortalForm } from "#/components/features/portal/CreatePortalForm";
import { Button } from "#/components/ui/button";
import type { AuthRouteContext } from "#/routes/_authenticated";
import { hasRole } from "#/shared/domain/roles";
import { useMutationAction } from "#/components/hooks/use-mutation-action";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/portals/new",
)({
	beforeLoad: ({ context }) => {
		const role = (context as AuthRouteContext).role;
		if (!hasRole(role, "PropertyManager")) {
			throw redirect({ to: "/properties" });
		}
	},
	component: CreatePortalPage,
});

function CreatePortalPage() {
	const { propertyId } = Route.useParams();
	const navigate = useNavigate();

	const mutation = useMutationAction(createPortal, {
		successMessage: "Portal created",
		onSuccess: async (output) => {
			navigate({
				to: "/properties/$propertyId/portals/$portalId",
				params: {
					propertyId,
					portalId: output.portal.id,
				},
			});
		},
	});

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<Button variant="ghost" asChild>
				<Link to="/properties/$propertyId/portals" params={{ propertyId }}>
					<ArrowLeft />
					Back to Portals
				</Link>
			</Button>

			<div>
				<h1 className="text-xl font-semibold tracking-tight">Create Portal</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Set up a new guest-facing portal page.
				</p>
			</div>

			<CreatePortalForm propertyId={propertyId} mutation={mutation} />
			<div>
				<Button
					type="button"
					variant="outline"
					onClick={() =>
						navigate({
							to: "/properties/$propertyId/portals",
							params: { propertyId },
						})
					}
				>
					Cancel
				</Button>
			</div>
		</div>
	);
}

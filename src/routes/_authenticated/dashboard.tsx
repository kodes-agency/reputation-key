// Dashboard — protected route showing organization info
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { authClient } from "#/shared/auth/auth-client";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	CardDescription,
} from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { LogOut } from "lucide-react";
import {
	listUserOrganizations,
	setActiveOrganization,
} from "#/contexts/identity/server/organizations";
import { useAction, wrapAction } from "#/components/hooks/use-action";

function OrgSwitcher({
	organizations,
	activeOrg,
	onSwitch,
}: {
	organizations: ReadonlyArray<{ id: string; name: string }>;
	activeOrg: { id: string; name: string } | null;
	onSwitch: (orgId: string) => void;
}) {
	if (organizations.length <= 1) return null;
	return (
		<>
			<div className="flex flex-col gap-3">
				<p className="text-sm font-semibold">Switch Organization</p>
				<div className="flex flex-wrap gap-2">
					{organizations.map((org) => (
						<Button
							key={org.id}
							size="sm"
							variant={activeOrg?.id === org.id ? "default" : "outline"}
							onClick={() => onSwitch(org.id)}
						>
							{org.name}
						</Button>
					))}
				</div>
			</div>
			<Separator />
		</>
	);
}

export const Route = createFileRoute("/_authenticated/dashboard")({
	loader: async () => {
		const { organizations } = await listUserOrganizations();
		return { organizations };
	},
	component: DashboardPage,
});

function DashboardPage() {
	const ctx =
		Route.useRouteContext() as import("#/routes/_authenticated").AuthRouteContext;
	const user = ctx.user;
	const router = useRouter();
	const { organizations } = Route.useLoaderData();

	const setActiveOrg = useAction(useServerFn(setActiveOrganization));

	const activeOrg = organizations.length > 0 ? organizations[0] : null;

	const mutation = wrapAction(setActiveOrg, async () => {
		await router.invalidate();
	});

	return (
		<div className="page-wrap px-4 pb-8 pt-14">
			<Card className="island-shell rise-in rounded-2xl">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex flex-col gap-1">
							<CardTitle className="text-2xl">Dashboard</CardTitle>
							<CardDescription>
								Welcome back, {user?.name || "User"}!
								{activeOrg && (
									<span className="ml-2 text-sm">
										·{" "}
										<span className="font-medium text-primary">
											{activeOrg.name}
										</span>
									</span>
								)}
							</CardDescription>
						</div>
						<Button
							variant="outline"
							size="sm"
							onClick={() => authClient.signOut()}
						>
							<LogOut />
							Sign out
						</Button>
					</div>
				</CardHeader>

				<CardContent>
					{organizations.length === 0 ? (
						<Card className="border-dashed">
							<CardContent className="flex flex-col items-center gap-2 py-8 text-center">
								<p className="font-medium">No organization found.</p>
								<p className="text-sm text-muted-foreground">
									Your account exists but no organization is set up. Please
									contact support.
								</p>
							</CardContent>
						</Card>
					) : (
						<div className="flex flex-col gap-4">
							<OrgSwitcher
								organizations={organizations}
								activeOrg={activeOrg}
								onSwitch={(orgId) =>
									mutation({ data: { organizationId: orgId } })
								}
							/>
							<p className="text-sm text-muted-foreground">
								Your dashboard is ready. Product features will appear here as
								they're built.
							</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

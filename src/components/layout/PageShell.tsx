/**
 * PageShell — shared outer layout for authenticated pages.
 * Eliminates the repeated Card wrapper pattern across routes.
 *
 * Usage:
 *   <PageShell title="Properties" description="Manage your properties" actions={<Button>Add</Button>}>
 *     {children}
 *   </PageShell>
 */

import type { ReactNode } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card";

type Props = Readonly<{
	title: string;
	description?: string;
	actions?: ReactNode;
	children: ReactNode;
}>;

export function PageShell({ title, description, actions, children }: Props) {
	return (
		<div className="page-wrap px-4 pb-8 pt-14">
			<Card className="island-shell rise-in rounded-2xl">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex flex-col gap-1">
							<CardTitle className="text-2xl">{title}</CardTitle>
							{description && <CardDescription>{description}</CardDescription>}
						</div>
						{actions}
					</div>
				</CardHeader>
				<CardContent>{children}</CardContent>
			</Card>
		</div>
	);
}

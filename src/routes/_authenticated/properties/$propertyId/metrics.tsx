import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/metrics",
)({
	component: MetricsPage,
});

function MetricsPage() {
	return (
		<div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<BarChart3 className="size-5 text-muted-foreground" />
			</div>
			<h2 className="text-lg font-medium">Metrics</h2>
			<p className="max-w-xs text-sm text-muted-foreground">
				Performance metrics and analytics are under development. Track
				reputation scores, response rates, and trends here.
			</p>
		</div>
	);
}

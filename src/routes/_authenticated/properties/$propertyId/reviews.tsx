import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/reviews",
)({
	component: ReviewsPage,
});

function ReviewsPage() {
	return (
		<div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted">
				<MessageSquare className="size-5 text-muted-foreground" />
			</div>
			<h2 className="text-lg font-medium">Reviews</h2>
			<p className="max-w-xs text-sm text-muted-foreground">
				Review management is under development. You'll be able to see and
				respond to all your reviews here.
			</p>
		</div>
	);
}

// Portal context — shared inline link form for add and edit modes

import { useState } from "react";
import { Input } from "#/components/ui/input";
import { Button } from "#/components/ui/button";
import { Loader2 } from "lucide-react";

type Props = Readonly<{
	initialLabel?: string;
	initialUrl?: string;
	submitLabel: string;
	onSubmit: (label: string, url: string) => Promise<void> | void;
	onCancel: () => void;
	isPending?: boolean;
	error?: unknown;
	className?: string;
}>;

export function LinkInlineForm({
	initialLabel = "",
	initialUrl = "",
	submitLabel,
	onSubmit,
	onCancel,
	isPending,
	error,
	className = "mb-2 flex flex-col gap-1 rounded-lg border bg-muted/30 p-3",
}: Props) {
	const [label, setLabel] = useState(initialLabel);
	const [url, setUrl] = useState(initialUrl);

	const handleSubmit = async () => {
		const trimmedLabel = label.trim();
		const trimmedUrl = url.trim();
		if (!trimmedLabel || !trimmedUrl) return;
		await onSubmit(trimmedLabel, trimmedUrl);
	};

	return (
		<div className={className}>
			<div className="flex gap-2">
				<Input
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder="Link label"
					disabled={isPending}
				/>
				<Input
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="https://..."
					disabled={isPending}
				/>
				<Button
					onClick={handleSubmit}
					disabled={!label.trim() || !url.trim() || isPending}
				>
					{isPending ? <Loader2 className="size-4 animate-spin" /> : null}
					{submitLabel}
				</Button>
				<Button variant="ghost" onClick={onCancel} disabled={isPending}>
					Cancel
				</Button>
			</div>
			{error != null ? (
				<p className="text-sm text-destructive">
					{error instanceof Error
						? error.message
						: `Failed to ${submitLabel.toLowerCase()} link`}
				</p>
			) : null}
		</div>
	);
}

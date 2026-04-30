// Portal context — inline link editing form (thin wrapper around LinkInlineForm)

import { LinkInlineForm } from "./LinkInlineForm";

type Props = Readonly<{
	initialLabel: string;
	initialUrl: string;
	onSubmit: (label: string, url: string) => Promise<void> | void;
	onCancel: () => void;
	isPending?: boolean;
	error?: unknown;
}>;

export function LinkEditInlineForm({
	initialLabel,
	initialUrl,
	onSubmit,
	onCancel,
	isPending,
	error,
}: Props) {
	return (
		<LinkInlineForm
			initialLabel={initialLabel}
			initialUrl={initialUrl}
			submitLabel="Save"
			onSubmit={onSubmit}
			onCancel={onCancel}
			isPending={isPending}
			error={error}
			className="mb-2 flex flex-col gap-1 rounded-lg border bg-muted/30 p-3"
		/>
	);
}

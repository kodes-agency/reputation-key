// Portal context — inline link creation form (thin wrapper around LinkInlineForm)

import { LinkInlineForm } from "./LinkInlineForm";

type Props = Readonly<{
	onSubmit: (label: string, url: string) => Promise<void> | void;
	onCancel: () => void;
	isPending?: boolean;
	error?: unknown;
}>;

export function LinkAddInlineForm({
	onSubmit,
	onCancel,
	isPending,
	error,
}: Props) {
	return (
		<LinkInlineForm
			submitLabel="Add"
			onSubmit={async (label, url) => {
				await onSubmit(label, url);
			}}
			onCancel={onCancel}
			isPending={isPending}
			error={error}
			className="mb-4 flex flex-col gap-1 rounded-lg border p-3"
		/>
	);
}

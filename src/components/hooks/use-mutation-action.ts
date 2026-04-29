/**
 * useMutationAction — eliminates the repeated useAction+useServerFn+wrapAction+toast+invalidate
 * boilerplate across route files.
 *
 * Before (3-5 lines per mutation, repeated 10+ times):
 *   const rawFn = useAction(useServerFn(serverFn))
 *   const mutation = wrapAction(rawFn, async () => {
 *     await router.invalidate()
 *     toast.success('Done')
 *   })
 *
 * After (1 line):
 *   const mutation = useMutationAction(serverFn, { successMessage: 'Done' })
 *
 * Auto-toasts on success. Auto-invalidates router. Optional post-success navigation.
 * Returns Action<TInput, TOutput> — compatible with all existing form components.
 * Fully type-safe — no casts, same generic constraint as useAction.
 */

import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAction, wrapAction } from "./use-action";
import type { Action } from "./use-action";

// fallow-ignore-next-line unused-type
export interface MutationActionOptions<TOutput> {
	/** Message shown via toast.success on success. Defaults to 'Saved'. */
	successMessage?: string;
	/** Whether to call router.invalidate() after success. Defaults to true. */
	invalidate?: boolean;
	/** Navigate after success. */
	navigateTo?: string;
	/** Custom post-success callback (runs after invalidate and toast). */
	onSuccess?: (output: TOutput) => void | Promise<void>;
}

/**
 * Combines useAction + useServerFn + wrapAction + router.invalidate() + toast
 * into a single hook call. Same generic constraint as useAction — fully type-safe.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useMutationAction<TFn extends (...args: any[]) => Promise<any>>(
	serverFn: TFn,
	options?: MutationActionOptions<Awaited<ReturnType<TFn>>>,
): Action<Parameters<TFn>[0], Awaited<ReturnType<TFn>>> {
	const router = useRouter();
	const rawAction = useAction(useServerFn(serverFn));

	const {
		successMessage = "Saved",
		invalidate = true,
		navigateTo,
		onSuccess,
	} = options ?? {};

	return wrapAction(rawAction, async (output) => {
		if (invalidate) {
			await router.invalidate();
		}

		toast.success(successMessage);

		if (onSuccess) {
			await onSuccess(output);
		}

		if (navigateTo) {
			router.navigate({ to: navigateTo });
		}
	});
}

/**
 * Silent variant — no toast, still invalidates router.
 * Useful for inline mutations (not form-driven).
 */
export function useMutationActionSilent<
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	TFn extends (...args: any[]) => Promise<any>,
>(
	serverFn: TFn,
	options?: {
		invalidate?: boolean;
		onSuccess?: (output: Awaited<ReturnType<TFn>>) => void | Promise<void>;
	},
): Action<Parameters<TFn>[0], Awaited<ReturnType<TFn>>> {
	const router = useRouter();
	const rawAction = useAction(useServerFn(serverFn));

	const { invalidate = true, onSuccess } = options ?? {};

	return wrapAction(rawAction, async (output) => {
		if (invalidate) {
			await router.invalidate();
		}
		if (onSuccess) {
			await onSuccess(output);
		}
	});
}

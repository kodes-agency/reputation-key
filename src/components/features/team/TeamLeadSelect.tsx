/**
 * TeamLeadSelect — shared team lead picker used in CreateTeamForm and EditTeamForm.
 * Extracted to eliminate the duplicated Select render-prop block.
 */

import type { BaseFieldApi } from "#/components/forms/FormTextField";
import { Field, FieldLabel, FieldError } from "#/components/ui/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";

type MemberOption = { userId: string; name: string; email: string };

type Props = Readonly<{
	field: BaseFieldApi;
	members: ReadonlyArray<MemberOption>;
	label?: string;
}>;

export function TeamLeadSelect({
	field,
	members,
	label = "Team lead (optional)",
}: Props) {
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel>{label}</FieldLabel>
			<Select
				value={field.state.value || "__none__"}
				onValueChange={(value) =>
					field.handleChange(value === "__none__" ? "" : value)
				}
			>
				<SelectTrigger aria-invalid={isInvalid}>
					<SelectValue placeholder="No team lead" />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectItem value="__none__">
							<span className="italic text-muted-foreground">None</span>
						</SelectItem>
						{members.map((m) => (
							<SelectItem key={m.userId} value={m.userId}>
								{m.name} — {m.email}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			{isInvalid && <FieldError errors={field.state.meta.errors} />}
		</Field>
	);
}

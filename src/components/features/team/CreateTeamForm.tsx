// Create team form — used in property teams page
// Per architecture: receives mutation as a prop, uses DTO schema for validation.

import { useForm } from "@tanstack/react-form";
import { FieldGroup } from "#/components/ui/field";
import { FormTextField } from "#/components/forms/FormTextField";
import type { BaseFieldApi } from "#/components/forms/FormTextField";
import { FormTextarea } from "#/components/forms/FormTextarea";
import type { BaseFieldApiTextarea } from "#/components/forms/FormTextarea";
import { TeamLeadSelect } from "#/components/features/team/TeamLeadSelect";
import { SubmitButton } from "#/components/forms/SubmitButton";
import { FormErrorBanner } from "#/components/forms/FormErrorBanner";
import { createTeamInputSchema } from "#/contexts/team/application/dto/create-team.dto";
import type { CreateTeamInput } from "#/contexts/team/application/dto/create-team.dto";

type MemberOption = { userId: string; name: string; email: string };

import type { Action } from "#/components/hooks/use-action";

const formSchema = createTeamInputSchema
	.pick({ propertyId: true, name: true, description: true, teamLeadId: true })
	.required();

type Props = Readonly<{
	propertyId: string;
	mutation: Action<{ data: CreateTeamInput }>;
	members?: ReadonlyArray<MemberOption>;
}>;

export function CreateTeamForm({ propertyId, mutation, members }: Props) {
	const form = useForm({
		defaultValues: {
			propertyId,
			name: "",
			description: "" as string | undefined,
			teamLeadId: "" as string | undefined,
		},
		validators: {
			onSubmit: formSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation({
				data: {
					...value,
					description: value.description || undefined,
					teamLeadId: value.teamLeadId || undefined,
				},
			});
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
			className="space-y-4"
		>
			<FormErrorBanner error={mutation.error} />

			<FieldGroup>
				<form.Field name="name">
					{(field: BaseFieldApi) => (
						<FormTextField
							field={field}
							label="Team name"
							id="team-name"
							placeholder="Front Desk"
						/>
					)}
				</form.Field>

				<form.Field name="description">
					{(field: BaseFieldApiTextarea) => (
						<FormTextarea
							field={field}
							label="Description (optional)"
							id="team-description"
							placeholder="Describe this team's responsibilities"
							rows={2}
						/>
					)}
				</form.Field>

				{members && members.length > 0 && (
					<form.Field name="teamLeadId">
						{(field: BaseFieldApi) => (
							<TeamLeadSelect field={field} members={members} />
						)}
					</form.Field>
				)}
			</FieldGroup>

			<SubmitButton mutation={mutation} form={form}>
				Create team
			</SubmitButton>
		</form>
	);
}

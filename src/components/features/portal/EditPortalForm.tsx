// Portal context — edit portal settings form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from "@tanstack/react-form";
import { z } from "zod/v4";
import { Field, FieldLabel, FieldGroup } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { SubmitButton } from "#/components/forms/SubmitButton";
import { FormErrorBanner } from "#/components/forms/FormErrorBanner";
import { FormTextField } from "#/components/forms/FormTextField";
import { FormTextarea } from "#/components/forms/FormTextarea";
import type { BaseFieldApi } from "#/components/forms/FormTextField";
import type { BaseFieldApiTextarea } from "#/components/forms/FormTextarea";
import { updatePortalInputSchema } from "#/contexts/portal/application/dto/update-portal.dto";
import type { Action } from "#/components/hooks/use-action";
import {
	requestUploadUrl,
	finalizeUpload,
} from "#/contexts/portal/server/portals";
import { Button } from "#/components/ui/button";
import { Upload, ImageIcon } from "lucide-react";
import { useState } from "react";

const editFormSchema = updatePortalInputSchema
	.omit({ portalId: true, isActive: true })
	.extend({
		name: z.string().min(1, "Name is required").max(100),
		slug: z.string().min(2, "Slug must be at least 2 characters").max(64),
		description: z.string().max(500),
		primaryColor: z.string().min(1, "Color is required"),
		smartRoutingEnabled: z.boolean(),
		smartRoutingThreshold: z.number().int().min(1).max(4),
	});

type FormValues = z.infer<typeof editFormSchema>;

type UpdatePortalVariables = {
	data: {
		portalId: string;
		name?: string;
		slug?: string;
		description?: string | null;
		theme?: { primaryColor: string };
		smartRoutingEnabled?: boolean;
		smartRoutingThreshold?: number;
	};
};

type PortalData = Readonly<{
	id: string;
	name: string;
	slug: string;
	description: string | null;
	theme: { primaryColor: string };
	smartRoutingEnabled: boolean;
	smartRoutingThreshold: number;
	heroImageUrl: string | null;
}>;

type Props = Readonly<{
	portal: PortalData;
	mutation: Action<UpdatePortalVariables>;
	canEdit: boolean;
}>;

export function EditPortalForm({ portal, mutation, canEdit }: Props) {
	const [heroImageUrl, setHeroImageUrl] = useState(portal.heroImageUrl);
	const [uploading, setUploading] = useState(false);

	const form = useForm({
		defaultValues: {
			name: portal.name,
			slug: portal.slug,
			description: portal.description ?? "",
			primaryColor: portal.theme.primaryColor,
			smartRoutingEnabled: portal.smartRoutingEnabled,
			smartRoutingThreshold: portal.smartRoutingThreshold,
		} satisfies FormValues,
		validators: {
			onSubmit: editFormSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation({
				data: {
					portalId: portal.id,
					name: value.name,
					slug: value.slug,
					description: value.description || null,
					theme: { primaryColor: value.primaryColor },
					smartRoutingEnabled: value.smartRoutingEnabled,
					smartRoutingThreshold: value.smartRoutingThreshold,
				},
			});
		},
	});

	const handleImageUpload = async (file: File) => {
		if (!file.type.startsWith("image/")) {
			alert("Please select an image file");
			return;
		}
		if (file.size > 10 * 1024 * 1024) {
			alert("File size must be less than 10 MB");
			return;
		}

		setUploading(true);
		try {
			const { uploadUrl, key } = await requestUploadUrl({
				data: {
					portalId: portal.id,
					contentType: file.type,
					fileSize: file.size,
				},
			});

			const uploadRes = await fetch(uploadUrl, {
				method: "PUT",
				body: file,
				headers: { "Content-Type": file.type },
			});

			if (!uploadRes.ok) {
				throw new Error(`Upload failed: ${uploadRes.status}`);
			}

			const { heroImageUrl: url } = await finalizeUpload({
				data: { portalId: portal.id, key },
			});

			setHeroImageUrl(url);
		} catch (err) {
			console.error("Image upload failed:", err);
			alert("Failed to upload image. Please try again.");
		} finally {
			setUploading(false);
		}
	};

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit();
			}}
			className="flex flex-col gap-6"
		>
			<FormErrorBanner error={mutation.error} />

			{/* Hero image */}
			<div className="flex flex-col gap-4">
				<h3 className="font-semibold">Hero Image</h3>
				<div className="flex items-center gap-4">
					{heroImageUrl ? (
						<div className="relative">
							<img
								src={heroImageUrl}
								alt="Portal hero"
								className="h-32 w-48 rounded-lg object-cover"
							/>
						</div>
					) : (
						<div className="flex h-32 w-48 items-center justify-center rounded-lg border border-dashed bg-muted">
							<ImageIcon className="size-8 text-muted-foreground" />
						</div>
					)}
					{canEdit && (
						<div className="flex flex-col gap-2">
							<label className="cursor-pointer">
								<input
									type="file"
									accept="image/*"
									className="sr-only"
									onChange={(e) => {
										const file = e.target.files?.[0];
										if (file) void handleImageUpload(file);
									}}
									disabled={uploading}
								/>
								<Button
									type="button"
									variant="outline"
									disabled={uploading}
									asChild
								>
									<span>
										<Upload className="mr-2 size-4" />
										{uploading ? "Uploading..." : "Upload Image"}
									</span>
								</Button>
							</label>
							<p className="text-xs text-muted-foreground">
								Max 10 MB. JPG, PNG, WebP.
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Basic info */}
			<div className="flex flex-col gap-4">
				<h3 className="font-semibold">Basic Info</h3>
				<FieldGroup>
					<form.Field name="name">
						{(field: BaseFieldApi) => (
							<FormTextField
								field={field}
								label="Name"
								id="edit-portal-name"
								disabled={!canEdit}
							/>
						)}
					</form.Field>

					<form.Field name="description">
						{(field: BaseFieldApiTextarea) => (
							<FormTextarea
								field={field}
								label="Description"
								id="edit-portal-description"
								rows={3}
								disabled={!canEdit}
							/>
						)}
					</form.Field>
				</FieldGroup>
			</div>

			{/* Theme */}
			<div className="flex flex-col gap-4">
				<h3 className="font-semibold">Theme</h3>
				<form.Field name="primaryColor">
					{(field) => {
						const isInvalid =
							field.state.meta.isTouched && !field.state.meta.isValid;
						return (
							<Field data-invalid={isInvalid}>
								<div className="flex items-center gap-3">
									<FieldLabel htmlFor="edit-portal-primary-color">
										Primary Color
									</FieldLabel>
									<input
										type="color"
										id="edit-portal-primary-color"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										className="size-10 cursor-pointer rounded border"
										disabled={!canEdit}
									/>
									<Input
										value={field.state.value}
										onChange={(e) => {
											const v = e.target.value;
											field.handleChange(
												v.startsWith("#") || v === "" ? v : `#${v}`,
											);
										}}
										onBlur={field.handleBlur}
										className="w-32"
										aria-invalid={isInvalid}
										disabled={!canEdit}
									/>
								</div>
							</Field>
						);
					}}
				</form.Field>
			</div>

			{/* Smart routing */}
			<div className="flex flex-col gap-4">
				<h3 className="font-semibold">Smart Routing</h3>
				<form.Field name="smartRoutingEnabled">
					{(field) => (
						<div className="flex items-center justify-between rounded-lg border p-4">
							<div>
								<p className="font-medium">Enable Smart Routing</p>
								<p className="text-sm text-muted-foreground">
									Show review links only to guests rating above the threshold.
								</p>
							</div>
							<input
								type="checkbox"
								checked={field.state.value}
								onChange={(e) => field.handleChange(e.target.checked)}
								className="size-5 cursor-pointer rounded border"
								disabled={!canEdit}
							/>
						</div>
					)}
				</form.Field>

				<form.Field name="smartRoutingThreshold">
					{(field) =>
						field.state.value > 0 && (
							<div className="flex flex-col gap-2">
								<FieldLabel>
									Rating Threshold ({field.state.value}+ stars)
								</FieldLabel>
								<input
									type="range"
									min={1}
									max={4}
									value={field.state.value}
									onChange={(e) => field.handleChange(Number(e.target.value))}
									className="w-full"
									disabled={!canEdit}
								/>
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>1 star</span>
									<span>4 stars</span>
								</div>
							</div>
						)
					}
				</form.Field>
			</div>

			{canEdit && (
				<SubmitButton mutation={mutation} form={form}>
					Save Changes
				</SubmitButton>
			)}
		</form>
	);
}

// Portal links editor — link tree builder tab

import { createFileRoute, Link } from "@tanstack/react-router";
import { getPortal } from "#/contexts/portal/server/portals";
import {
	createLinkCategory,
	reorderCategories,
	deleteLinkCategory,
	createLink,
	deleteLink,
	updateLink,
	updateLinkCategory,
	reorderLinks,
} from "#/contexts/portal/server/portal-links";
import { PortalTabNav } from "#/components/features/portal/PortalTabNav";
import { SortableCategory } from "#/components/features/portal/SortableCategory";
import { LinkAddInlineForm } from "#/components/features/portal/LinkAddInlineForm";
import { LinkEditInlineForm } from "#/components/features/portal/LinkEditInlineForm";
import { CategoryAddForm } from "#/components/features/portal/CategoryAddForm";
import { CategoryEditInlineForm } from "#/components/features/portal/CategoryEditInlineForm";
import { hasRole } from "#/shared/domain/roles";
import { Button } from "#/components/ui/button";

import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { generateKeyBetween } from "fractional-indexing";
import {
	useMutationAction,
	useMutationActionSilent,
} from "#/components/hooks/use-mutation-action";
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";

export const Route = createFileRoute(
	"/_authenticated/properties/$propertyId/portals/$portalId/links",
)({
	loader: async ({ params }) => {
		const { portal } = await getPortal({ data: { portalId: params.portalId } });
		return { portal, propertyId: params.propertyId, portalId: params.portalId };
	},
	component: PortalLinksPage,
});

// Stub types — in full implementation these come from server functions
type Category = { id: string; title: string; sortKey: string };
type LinkItem = {
	id: string;
	label: string;
	url: string;
	sortKey: string;
	categoryId: string;
};

function PortalLinksPage() {
	const ctx = Route.useRouteContext();
	const { propertyId, portalId } = Route.useLoaderData();
	const canEdit = hasRole(ctx.role, "PropertyManager");

	// Local state for categories and links (in full implementation, loaded from server)
	const [categories, setCategories] = useState<Category[]>([]);
	const [links, setLinks] = useState<LinkItem[]>([]);
	const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
	const [editingLink, setEditingLink] = useState<string | null>(null);
	const [editingCategory, setEditingCategory] = useState<string | null>(null);
	const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
	const [deletingLinkId, setDeletingLinkIdState] = useState<string | null>(null);

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const createCategoryMutation = useMutationAction(createLinkCategory, {
		successMessage: "Category created",
	});
	const createLinkMutation = useMutationAction(createLink, {
		successMessage: "Link created",
	});
	const deleteCategoryMutation = useMutationActionSilent(deleteLinkCategory);
	const deleteLinkMutation = useMutationActionSilent(deleteLink);
	const reorderCategoriesMutation = useMutationActionSilent(reorderCategories);
	const reorderLinksMutation = useMutationActionSilent(reorderLinks);
	const updateLinkMutation = useMutationAction(updateLink, {
		successMessage: "Link updated",
	});
	const updateCategoryMutation = useMutationAction(updateLinkCategory, {
		successMessage: "Category updated",
	});

	const handleAddCategory = async (title: string) => {
		try {
			const result = await createCategoryMutation({
				data: { portalId, title },
			});
			setCategories((prev) => [
				...prev,
				{
					id: result.category.id,
					title: result.category.title,
					sortKey: result.category.sortKey,
				},
			]);
		} catch (err) {
			console.error("Failed to create category:", err);
		}
	};

	const handleAddLink = async (
		categoryId: string,
		label: string,
		url: string,
	) => {
		try {
			const result = await createLinkMutation({
				data: { categoryId, portalId, label, url },
			});
			setLinks((prev) => [
				...prev,
				{
					id: result.link.id,
					label: result.link.label,
					url: result.link.url,
					sortKey: result.link.sortKey,
					categoryId,
				},
			]);
			setAddingToCategory(null);
		} catch (err) {
			console.error("Failed to create link:", err);
		}
	};

	const handleDeleteCategory = async (catId: string) => {
		setDeletingCategoryId(catId);
		try {
			await deleteCategoryMutation({ data: { categoryId: catId } });
			setCategories((prev) => prev.filter((c) => c.id !== catId));
			setLinks((prev) => prev.filter((l) => l.categoryId !== catId));
		} catch (err) {
			console.error("Failed to delete category:", err);
		} finally {
			setDeletingCategoryId(null);
		}
	};

	const handleDeleteLink = async (linkId: string) => {
		setDeletingLinkIdState(linkId);
		try {
			await deleteLinkMutation({ data: { linkId } });
			setLinks((prev) => prev.filter((l) => l.id !== linkId));
		} catch (err) {
			console.error("Failed to delete link:", err);
		} finally {
			setDeletingLinkIdState(null);
		}
	};

	const handleUpdateLink = async (
		linkId: string,
		label: string,
		url: string,
	) => {
		try {
			const result = await updateLinkMutation({
				data: { linkId, label, url },
			});
			setLinks((prev) =>
				prev.map((l) =>
					l.id === linkId
						? { ...l, label: result.link.label, url: result.link.url }
						: l,
				),
			);
			setEditingLink(null);
		} catch (err) {
			console.error("Failed to update link:", err);
		}
	};

	const handleUpdateCategory = async (catId: string, title: string) => {
		try {
			const result = await updateCategoryMutation({
				data: { categoryId: catId, title },
			});
			setCategories((prev) =>
				prev.map((c) =>
					c.id === catId ? { ...c, title: result.category.title } : c,
				),
			);
			setEditingCategory(null);
		} catch (err) {
			console.error("Failed to update category:", err);
		}
	};

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const oldIndex = categories.findIndex((c) => c.id === active.id);
		const newIndex = categories.findIndex((c) => c.id === over.id);
		const reordered = arrayMove(categories, oldIndex, newIndex);

		setCategories(reordered);

		const updates = reordered.map((cat, i) => {
			const prev = i > 0 ? reordered[i - 1].sortKey : null;
			const sortKey = generateKeyBetween(prev, cat.sortKey);
			return { id: cat.id, sortKey };
		});

		try {
			await reorderCategoriesMutation({
				data: { portalId, items: updates },
			});
		} catch (err) {
			console.error("Failed to reorder categories:", err);
		}
	};

	const handleReorderLinks = async (
		categoryId: string,
		reordered: LinkItem[],
	) => {
		const otherLinks = links.filter((l) => l.categoryId !== categoryId);

		const updates = reordered.map((link, i) => {
			const prev = i > 0 ? reordered[i - 1].sortKey : null;
			const sortKey = generateKeyBetween(prev, link.sortKey);
			return { id: link.id, sortKey };
		});

		setLinks([
			...otherLinks,
			...reordered.map((l, i) => ({ ...l, sortKey: updates[i].sortKey })),
		]);

		try {
			await reorderLinksMutation({
				data: { portalId, categoryId, items: updates },
			});
		} catch (err) {
			console.error("Failed to reorder links:", err);
		}
	};

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<div className="flex items-center gap-2">
				<Button variant="ghost" asChild>
					<Link to="/properties/$propertyId/portals" params={{ propertyId }}>
						<ArrowLeft />
						Back
					</Link>
				</Button>
			</div>

			<PortalTabNav
				propertyId={propertyId}
				portalId={portalId}
				activeTab="links"
			/>

			<div>
				<h1 className="text-xl font-semibold tracking-tight">Link Tree</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Organize links into categories for your portal visitors.
				</p>
			</div>
					{canEdit && (
						<CategoryAddForm
							onSubmit={handleAddCategory}
							isPending={createCategoryMutation.isPending}
							error={createCategoryMutation.error}
						/>
					)}

					{addingToCategory && canEdit && (
						<LinkAddInlineForm
							onSubmit={(label, url) =>
								handleAddLink(addingToCategory, label, url)
							}
							onCancel={() => setAddingToCategory(null)}
							isPending={createLinkMutation.isPending}
							error={createLinkMutation.error}
						/>
					)}

					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragEnd={handleDragEnd}
					>
						<SortableContext
							items={categories.map((c) => c.id)}
							strategy={verticalListSortingStrategy}
						>
							<div className="flex flex-col gap-4">
								{categories.map((cat) => (
									<div key={cat.id}>
										{editingCategory === cat.id && canEdit ? (
											<CategoryEditInlineForm
												initialTitle={cat.title}
												onSubmit={(title) =>
													handleUpdateCategory(cat.id, title)
												}
												onCancel={() => setEditingCategory(null)}
												isPending={updateCategoryMutation.isPending}
												error={updateCategoryMutation.error}
											/>
										) : (
											<SortableCategory
												category={cat}
												links={links.filter((l) => l.categoryId === cat.id)}
													isDeletingCategory={deletingCategoryId === cat.id}
													deletingLinkId={deletingLinkId ?? undefined}
												onAddLink={(catId) => {
													setAddingToCategory(catId);
													setEditingLink(null);
													setEditingCategory(null);
												}}
												onDeleteLink={handleDeleteLink}
												onDeleteCategory={handleDeleteCategory}
												onEditCategory={(c) => setEditingCategory(c.id)}
												onEditLink={(link) => {
													setEditingLink(link.id);
													setAddingToCategory(null);
													setEditingCategory(null);
												}}
												onReorderLinks={handleReorderLinks}
												canEdit={canEdit}
											/>
										)}
										{editingLink &&
											links
												.filter((l) => l.categoryId === cat.id)
												.map((link) =>
													link.id === editingLink && canEdit ? (
														<LinkEditInlineForm
															key={link.id}
															initialLabel={link.label}
															initialUrl={link.url}
															onSubmit={(label, url) =>
																handleUpdateLink(link.id, label, url)
															}
															onCancel={() => setEditingLink(null)}
															isPending={updateLinkMutation.isPending}
															error={updateLinkMutation.error}
														/>
													) : null,
												)}
									</div>
								))}
							</div>
						</SortableContext>
					</DndContext>

					{categories.length === 0 && (
						<div className="py-8 text-center">
							<p className="text-muted-foreground">
								No categories yet. Create one to start organizing links.
							</p>
						</div>
					)}
		</div>
	);
}

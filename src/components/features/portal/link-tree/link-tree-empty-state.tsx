// Empty state for link tree when no categories exist

export function LinkTreeEmptyState() {
  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground">
        No categories yet. Create one to start organizing links.
      </p>
    </div>
  )
}

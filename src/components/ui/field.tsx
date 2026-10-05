import { useMemo } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'
import { Label } from '#/components/ui/label'

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        'group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4',
        className,
      )}
      {...props}
    />
  )
}

const fieldVariants = cva(
  'group/field flex w-full gap-3 data-[invalid=true]:text-negative',
  {
    variants: {
      orientation: {
        vertical: ['flex-col [&>*]:w-full [&>.sr-only]:w-auto'],
        horizontal: [
          'flex-row items-center',
          '[&>[data-slot=field-label]]:flex-auto',
          'has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
        ],
        responsive: [
          'flex-col @md/field-group:flex-row @md/field-group:items-center [&>*]:w-full @md/field-group:[&>*]:w-auto [&>.sr-only]:w-auto',
          '@md/field-group:[&>[data-slot=field-label]]:flex-auto',
          '@md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
        ],
      },
    },
    defaultVariants: {
      orientation: 'vertical',
    },
  },
)

function Field({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  optional = false,
  children,
  ...props
}: React.ComponentProps<typeof Label> & {
  /** The person may leave the field empty: "Optional", after the label text. */
  optional?: boolean
}) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>*]:data-[slot=field]:p-4',
        'has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 dark:has-data-[state=checked]:bg-primary/10',
        className,
      )}
      {...props}
    >
      {children}
      {optional ? <FieldOptional /> : null}
    </Label>
  )
}

/**
 * The marker of a field the person may leave empty, for a label that arranges its
 * own parts (`FieldLabel optional` is the usual way). It belongs inside the label,
 * so the control's name carries it; the space is for that name ("Note Optional"):
 * a flex row draws none of it.
 */
function FieldOptional() {
  return (
    <>
      {' '}
      <span data-slot="field-optional" className="font-normal text-muted-foreground">
        Optional
      </span>
    </>
  )
}

/**
 * The line of help under a control: what the field is for, or the rule it follows.
 * Name it as the control's description (`aria-describedby`); `Form*Field` do. It keeps
 * the muted ink inside a Field that has turned invalid, so help never reads as an error.
 */
function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-sm font-normal text-muted-foreground', className)}
      {...props}
    />
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error, index) => error?.message && <li key={index}>{error.message}</li>,
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn('text-sm font-normal text-negative', className)}
      {...props}
    >
      {content}
    </div>
  )
}

export { Field, FieldLabel, FieldOptional, FieldDescription, FieldError, FieldGroup }

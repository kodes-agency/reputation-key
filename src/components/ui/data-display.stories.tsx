import type { Meta, StoryObj } from '@storybook/react'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './table'
import { Skeleton } from './skeleton'

const meta: Meta<typeof Table> = {
  title: 'UI/Data Display',
  component: Table,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
}

export default meta
type Story = StoryObj<typeof Table>

const properties = [
  {
    name: 'Riverside Warehouse',
    location: 'Manchester, UK',
    units: 24,
    status: 'Active',
    revenue: '£48,200',
  },
  {
    name: 'Harbour View Apartments',
    location: 'Bristol, UK',
    units: 18,
    status: 'Under review',
    revenue: '£31,500',
  },
  {
    name: 'Old Mill Lofts',
    location: 'Leeds, UK',
    units: 12,
    status: 'Vacant',
    revenue: '£0',
  },
]

const totalRevenue = properties
  .reduce((sum, p) => sum + Number(p.revenue.replace(/[^0-9.]/g, '')), 0)
  .toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  })

export const Default: Story = {
  render: () => (
    <Table>
      <TableCaption>Recent properties in the portfolio</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Units</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {properties.map((property) => (
          <TableRow key={property.name}>
            <TableCell className="font-medium">{property.name}</TableCell>
            <TableCell>{property.location}</TableCell>
            <TableCell>{property.units}</TableCell>
            <TableCell>{property.status}</TableCell>
            <TableCell className="text-right">{property.revenue}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4}>Total</TableCell>
          <TableCell className="text-right">{totalRevenue}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
}

export const Empty: Story = {
  render: () => (
    <Table>
      <TableCaption>No properties in this portfolio yet</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Units</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
            No properties yet.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
}

export const Loading: Story = {
  render: () => (
    <Table>
      <TableCaption>Loading properties…</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Units</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 4 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton className="h-4 w-[140px]" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-[110px]" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-8" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-20" />
            </TableCell>
            <TableCell className="text-right">
              <Skeleton className="ml-auto h-4 w-16" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
}

// Shared domain barrel — re-exports all shared domain utilities
// Contexts import from here, never from the individual files directly.

export type {
// fallow-ignore-next-line unused-type
	OrganizationId,
// fallow-ignore-next-line unused-type
	UserId,
// fallow-ignore-next-line unused-type
	PropertyId,
// fallow-ignore-next-line unused-type
	TeamId,
} from "./ids";

export type { Result } from "./result";
export {
	ok,
	err,
} from "./result";

// fallow-ignore-next-line unused-type
export type { TaggedError } from "./errors";
// fallow-ignore-next-line unused-type
export type { Clock } from "./clock";
// fallow-ignore-next-line unused-type
export type { AuthContext } from "./auth-context";
// fallow-ignore-next-line unused-type
export type { Role } from "./roles";
// fallow-ignore-next-line unused-type
export type { BetterAuthRole } from "./roles";
// fallow-ignore-next-line unused-type
export type { PropertyAccessProvider } from "./property-access.port";

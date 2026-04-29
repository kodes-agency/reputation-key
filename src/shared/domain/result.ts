// Result type — re-exports from neverthrow
// Domain functions that can fail return Result<T, E>.
// Application layer unwraps and throws tagged errors at the boundary.
export {
	Result,
	ok,
	err,
} from "neverthrow";

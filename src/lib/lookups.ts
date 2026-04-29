/**
 * Shared lookup map builders — eliminates duplicated Map construction across routes.
 *
 * Pure functions, fully typed. Routes import these instead of building maps inline.
 */

// ── Input types ────────────────────────────────────────────────────────────
// These match the shapes returned by server functions (listMembers, listTeams, etc.)

export interface MemberLike {
	userId: string;
	name: string;
	email: string;
}

export interface TeamLike {
	id: string;
	name: string;
}

export interface AssignmentLike {
	id: string;
	userId: string;
	teamId: string | null;
}

// ── Lookup builders ────────────────────────────────────────────────────────

/** Build userId → { name, email } lookup from a members array. */
export function buildMemberLookup(
	members: ReadonlyArray<MemberLike>,
): Map<string, { name: string; email: string }> {
	const map = new Map<string, { name: string; email: string }>();
	for (const m of members) {
		map.set(m.userId, { name: m.name, email: m.email });
	}
	return map;
}

/** Build teamId → team name lookup from a teams array. */
export function buildTeamLookup(
	teams: ReadonlyArray<TeamLike>,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const t of teams) {
		map.set(t.id, t.name);
	}
	return map;
}

/** Group assignment IDs by teamId. Only includes assignments WITH a teamId. */
export function groupAssignmentsByTeam(
	assignments: ReadonlyArray<AssignmentLike>,
): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const a of assignments) {
		if (a.teamId) {
			const existing = map.get(a.teamId) ?? [];
			existing.push(a.id);
			map.set(a.teamId, existing);
		}
	}
	return map;
}

/** Build assignmentId → userId lookup for cross-referencing. */
function buildAssignmentUserMap(
	assignments: ReadonlyArray<AssignmentLike>,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const a of assignments) {
		map.set(a.id, a.userId);
	}
	return map;
}

export function toMemberOptions(
	members: ReadonlyArray<{ userId: string; name: string; email: string }>,
): MemberLike[] {
	return members.map((m) => ({
		userId: m.userId,
		name: m.name,
		email: m.email,
	}));
}

export function toTeamOptions(
	teams: ReadonlyArray<{ id: string; name: string }>,
): TeamLike[] {
	return teams.map((t) => ({ id: t.id, name: t.name }));
}

/** Get members not yet assigned to a given team. */
export function getAvailableMembers(
	members: ReadonlyArray<MemberLike>,
	assignments: ReadonlyArray<AssignmentLike>,
	teamId: string,
): MemberLike[] {
	const teamUserIds = new Set(
		assignments.filter((a) => a.teamId === teamId).map((a) => a.userId),
	);
	return members.filter((m) => !teamUserIds.has(m.userId));
}

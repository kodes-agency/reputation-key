import { Link } from "@tanstack/react-router";
import { authClient } from "#/shared/auth/auth-client";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
} from "#/components/ui/dropdown-menu";
import ThemeToggle from "#/components/layout/ThemeToggle";

// ── Sub-components ───────────────────────────────────────────────────

function LogoLink() {
	return (
		<Button variant="outline" size="sm" className="rounded-full gap-2" asChild>
			<Link to="/">
				<span className="size-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
				Reputation Key
			</Link>
		</Button>
	);
}

function AuthActions({
	isLoggedIn,
	onSignOut,
}: {
	isLoggedIn: boolean;
	onSignOut: () => void;
}) {
	if (isLoggedIn) {
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="sm">
						Account
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem asChild>
						<Link to="/dashboard">Dashboard</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link to="/properties">Properties</Link>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={onSignOut}>Sign out</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<Button variant="outline" size="sm" asChild>
				<Link to="/login">Sign in</Link>
			</Button>
			<Button size="sm" asChild>
				<Link to="/register">Get started</Link>
			</Button>
		</div>
	);
}

// ── Main component ───────────────────────────────────────────────────

export default function Header({ onSignOut }: { onSignOut: () => void }) {
	const { data: session } = authClient.useSession();
	const isLoggedIn = !!session?.user;

	return (
		<header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
			<nav className="page-wrap flex items-center justify-between gap-3 py-3 sm:py-4">
				<div className="flex items-center gap-3">
					<LogoLink />
					{isLoggedIn && (
						<div className="hidden sm:flex items-center gap-1">
							<Button variant="ghost" size="sm" asChild>
								<Link
									to="/dashboard"
									activeOptions={{ exact: true }}
									className="[&.active]:font-semibold"
								>
									Dashboard
								</Link>
							</Button>
							<Button variant="ghost" size="sm" asChild>
								<Link
									to="/properties"
									activeOptions={{ exact: true }}
									className="[&.active]:font-semibold"
								>
									Properties
								</Link>
							</Button>
						</div>
					)}
				</div>
				<div className="flex items-center gap-2">
					<ThemeToggle />
					<AuthActions isLoggedIn={isLoggedIn} onSignOut={onSignOut} />
				</div>
			</nav>
		</header>
	);
}

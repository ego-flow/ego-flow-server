import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";

import { UserRole } from "#/constants/auth/auth-constants";
import { useAuth } from "#/hooks/useAuth";
import { defaultRepositoriesSearch } from "#/lib/route-search";

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

function AdminLayout() {
	const { isReady, isAuthenticated, session } = useAuth();

	if (!isReady) {
		return null;
	}

	if (!isAuthenticated) {
		return <Navigate to="/login" />;
	}

	if (session?.user?.role !== UserRole.Admin) {
		return <Navigate to="/repositories" search={defaultRepositoriesSearch} />;
	}

	return <Outlet />;
}

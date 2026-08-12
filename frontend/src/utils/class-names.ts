import { UserRole } from "#/constants/auth/auth-constants";
import { RepositoryRole } from "#/constants/repository/repository-constants";
import { VideoStatus } from "#/constants/video/video-constants";

export const videoStatusClassName = (status: VideoStatus | string) => {
	switch (status) {
		case VideoStatus.Processing:
			return "bg-sky-500/12 text-sky-700 dark:text-sky-300";
		case VideoStatus.Completed:
			return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
		case VideoStatus.Failed:
			return "bg-red-500/12 text-red-700 dark:text-red-300";
		default:
			return "bg-slate-500/12 text-slate-700 dark:text-slate-300";
	}
};

export const repositoryRoleClassName = (role: RepositoryRole | string) => {
	switch (role) {
		case RepositoryRole.Admin:
			return "bg-indigo-500/14 text-indigo-700 dark:text-indigo-300";
		case RepositoryRole.Maintain:
			return "bg-amber-500/14 text-amber-700 dark:text-amber-300";
		default:
			return "bg-slate-500/12 text-slate-700 dark:text-slate-300";
	}
};

export const userRoleClassName = (role: UserRole | string | undefined) =>
	role === UserRole.Admin
		? "bg-indigo-500/14 text-indigo-700 dark:text-indigo-300"
		: "bg-slate-500/12 text-slate-700 dark:text-slate-300";

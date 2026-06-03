import { type ReactNode, useId } from "react";

import { Button } from "#/components/ui/button";

type ConfirmDialogProps = {
	open: boolean;
	title: string;
	description?: ReactNode;
	children?: ReactNode;
	cancelLabel?: string;
	confirmLabel?: string;
	pendingLabel?: string;
	variant?: "default" | "destructive";
	isPending?: boolean;
	confirmDisabled?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
};

export function ConfirmDialog({
	open,
	title,
	description,
	children,
	cancelLabel = "Cancel",
	confirmLabel = "Confirm",
	pendingLabel,
	variant = "default",
	isPending = false,
	confirmDisabled = false,
	onCancel,
	onConfirm,
}: ConfirmDialogProps) {
	const titleId = useId();
	const descriptionId = useId();

	if (!open) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
			<section
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={description ? descriptionId : undefined}
				className="island-shell w-full max-w-lg rounded-2xl p-6 shadow-xl"
			>
				<p className="island-kicker mb-2">Confirmation</p>
				<h2
					id={titleId}
					className="text-2xl font-semibold text-[var(--sea-ink)]"
				>
					{title}
				</h2>
				{description ? (
					<div
						id={descriptionId}
						className="mt-3 text-sm text-[var(--sea-ink-soft)]"
					>
						{description}
					</div>
				) : null}
				{children ? <div className="mt-5">{children}</div> : null}

				<div className="mt-6 flex flex-wrap justify-end gap-3">
					<Button
						type="button"
						variant="outline"
						disabled={isPending}
						onClick={onCancel}
					>
						{cancelLabel}
					</Button>
					<Button
						type="button"
						variant={variant}
						disabled={isPending || confirmDisabled}
						onClick={onConfirm}
					>
						{isPending && pendingLabel ? pendingLabel : confirmLabel}
					</Button>
				</div>
			</section>
		</div>
	);
}

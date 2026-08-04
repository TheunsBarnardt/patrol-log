import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

export function Modal({ open, onClose, title, children, footer, size = "md" }: ModalProps) {
  if (!open) return null;
  const widthClass =
    size === "sm" ? "max-w-sm" : size === "xl" ? "max-w-4xl" : size === "lg" ? "max-w-2xl" : "max-w-lg";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-brand-ink/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-soft sm:rounded-2xl ${widthClass}`}
      >
        <div className="brand-stripe h-1 w-full rounded-t-2xl" />
        <div className="flex items-center justify-between border-b border-brand-line px-5 py-4 sm:px-6">
          <h2 className="text-base font-bold text-brand-ink">{title}</h2>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-brand-muted transition hover:bg-brand-primarySoft hover:text-brand-primary"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && (
          <div className="safe-pb flex justify-end gap-2 border-t border-brand-line px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Reusable form field with label */
export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-semibold text-brand-ink">
        {label} {required && <span className="text-brand-accent">*</span>}
      </label>
      {children}
    </div>
  );
}

/** Shared input styles */
export const inputCls =
  "w-full rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm text-brand-ink shadow-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25";
export const selectCls =
  "w-full rounded-xl border border-brand-line bg-white px-3 py-2.5 text-sm text-brand-ink shadow-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/25";

/** Primary action button */
export function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "danger" | "ghost";
  type?: "button" | "submit";
}) {
  const base =
    "min-h-[42px] px-4 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 active:scale-[0.98]";
  const variants = {
    primary: "bg-brand-primary text-white hover:bg-brand-primaryDark shadow-sm",
    danger: "bg-brand-accent text-white hover:bg-red-700 shadow-sm",
    ghost: "border border-brand-line text-brand-ink hover:bg-brand-primarySoft",
  };
  return (
    <button type={type} className={`${base} ${variants[variant]}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

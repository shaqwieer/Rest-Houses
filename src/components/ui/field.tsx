import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

/**
 * Form primitives from the design system screen ("الحقول").
 *
 * Shared so the label colour (bronze, 12.5px, weight 700), the 13px radius, the
 * sand-50 resting fill and the gold focus ring stay identical everywhere —
 * public booking form and admin editor alike.
 */

const CONTROL =
  "w-full rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[14.5px] text-ink " +
  "outline-none transition placeholder:text-off " +
  "focus:border-gold-500 focus:bg-surface focus:shadow-[0_0_0_3px_var(--gold-100)] " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const ERROR_CONTROL = "border-busy bg-busy-bg text-busy focus:border-busy focus:shadow-none";

export function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="text-[12.5px] font-bold text-bronze">
      {children}
      {required && <span className="text-busy"> *</span>}
    </span>
  );
}

type FieldShellProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label + control + error message, stacked. */
export function Field({ label, hint, error, required, className, children }: FieldShellProps) {
  return (
    <label className={clsx("flex flex-col gap-1.5", className)}>
      {label && <FieldLabel required={required}>{label}</FieldLabel>}
      {children}
      {error ? (
        <span className="text-[11.5px] font-semibold text-busy">{error}</span>
      ) : hint ? (
        <span className="text-[11.5px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextInput({
  className,
  invalid,
  ...rest
}: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input className={clsx(CONTROL, invalid && ERROR_CONTROL, className)} {...rest} />;
}

export function TextArea({
  className,
  invalid,
  ...rest
}: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      rows={4}
      className={clsx(CONTROL, "resize-y leading-[1.85]", invalid && ERROR_CONTROL, className)}
      {...rest}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...rest
}: ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select
      className={clsx(CONTROL, "cursor-pointer font-semibold", invalid && ERROR_CONTROL, className)}
      {...rest}
    >
      {children}
    </select>
  );
}

/**
 * Pill toggle used for every multi/single select in the design: city, occasion
 * and amenity filters, and the amenity picker in the listing editor.
 */
export function Chip({
  active,
  className,
  children,
  ...rest
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={clsx(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] transition",
        active
          ? "border-gold-600 bg-gold-100 font-bold text-bronze"
          : "border-line bg-surface font-medium text-ink hover:border-gold-500",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Read-only display field — e.g. the dates carried into the booking form. */
export function ReadonlyField({
  label,
  value,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <span className="flex items-center gap-2 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[14.5px] font-semibold text-ink">
        {icon}
        {value}
      </span>
    </div>
  );
}

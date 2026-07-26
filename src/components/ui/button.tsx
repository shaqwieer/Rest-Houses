import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

/**
 * The button family from the design system screen ("الأزرار"):
 * primary (gold gradient), dark, secondary (outlined), whatsapp, ghost, icon.
 *
 * One component so the pill radius, weights and hover treatments can't drift
 * apart across the twenty-odd places buttons appear.
 */

export type ButtonVariant =
  | "primary"
  | "dark"
  | "secondary"
  | "whatsapp"
  | "ghost"
  | "danger";

export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-bold whitespace-nowrap " +
  "transition-[filter,background-color,border-color,transform,box-shadow] duration-200 " +
  "disabled:cursor-not-allowed disabled:opacity-60 active:translate-y-px";

const VARIANTS: Record<ButtonVariant, string> = {
  // Gold gradient + gold glow — reserved for the single most important action
  // on a screen (search, send code, save).
  primary:
    "bg-linear-[140deg,var(--gold-500),var(--gold-600)] text-night-900 shadow-gold " +
    "hover:brightness-105 disabled:bg-sand-200 disabled:bg-none disabled:text-off disabled:shadow-none",
  // Desert night — secondary emphasis, e.g. "التفاصيل" on a card.
  dark: "bg-night-900 text-sand-100 hover:bg-night-700",
  // Outlined on a sand surface.
  secondary:
    "border border-line bg-surface text-ink hover:border-gold-500 hover:bg-gold-100",
  // WhatsApp green. Brand-locked: it signals which app is about to open.
  whatsapp:
    "bg-wa text-wa-ink shadow-[0_10px_26px_rgb(37_211_102/0.26)] hover:brightness-105",
  ghost: "text-bronze hover:bg-gold-100",
  danger: "bg-busy-bg text-busy hover:bg-[#f0d2cc]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-[13px]",
  md: "px-5 py-2.5 text-[14px]",
  lg: "px-6 py-3.5 text-[15px] font-display font-extrabold",
};

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width — used for mobile-first admin forms. */
  block?: boolean;
  children: ReactNode;
  className?: string;
};

export function Button({
  variant = "primary",
  size = "md",
  block,
  className,
  children,
  ...rest
}: CommonProps & Omit<ComponentProps<"button">, "children" | "className">) {
  return (
    <button
      className={clsx(BASE, VARIANTS[variant], SIZES[size], block && "w-full", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Same visual language, but a real anchor — for navigation and wa.me links. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  block,
  className,
  children,
  href,
  ...rest
}: CommonProps & { href: string } & Omit<
    ComponentProps<typeof Link>,
    "children" | "className" | "href"
  >) {
  const classes = clsx(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    block && "w-full",
    "no-underline hover:no-underline",
    className,
  );

  // External links (wa.me, maps, social) must not go through the client router.
  const isExternal = /^(https?:|mailto:|tel:)/.test(href);
  if (isExternal) {
    return (
      <a
        href={href}
        className={classes}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes} {...rest}>
      {children}
    </Link>
  );
}

/** Square icon-only button — favourite toggles, calendar arrows, admin actions. */
export function IconButton({
  className,
  children,
  ...rest
}: Omit<ComponentProps<"button">, "className"> & { className?: string; children: ReactNode }) {
  return (
    <button
      className={clsx(
        "grid size-9 place-items-center rounded-xl border border-line bg-surface",
        "text-ink transition hover:border-gold-500 disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

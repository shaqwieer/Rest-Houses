"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import { useT } from "@/lib/i18n/provider";

/**
 * Pill badges from the design system screen ("الشارات").
 *
 * A client component so `StatusBadge` can read the dictionary from context.
 * The alternative — every server page resolving the label itself and passing it
 * down — would scatter the status→label mapping across a dozen call sites,
 * which is exactly what this component exists to prevent. Server components can
 * render it unchanged; it simply becomes a client boundary.
 */

export type BadgeTone = "ok" | "gold" | "busy" | "night" | "sand" | "glass";

const TONES: Record<BadgeTone, string> = {
  ok: "bg-ok-bg text-ok",
  gold: "bg-gold-100 text-bronze",
  busy: "bg-busy-bg text-busy",
  night: "bg-night-900 text-sand-100",
  sand: "bg-sand-100 text-bronze",
  // Frosted, for badges that sit on top of a photo.
  glass: "bg-night-900/80 text-gold-300 backdrop-blur-sm",
};

export function Badge({
  tone = "gold",
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  icon?: IconName;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold",
        TONES[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </span>
  );
}

/**
 * Status pill for a booking request or an owner account.
 *
 * One component for both because the tone rule is the same either way — green
 * for the settled-good state, gold for "waiting on someone", red for refused or
 * stopped — and defining it once keeps an admin's colour intuition transferable
 * between tables.
 */
export function StatusBadge({ status }: { status: string }) {
  const t = useT();

  const tone: BadgeTone =
    status === "CONFIRMED" || status === "APPROVED"
      ? "ok"
      : status === "NEW" || status === "PENDING" || status === "EXPIRED"
        ? "gold"
        : "busy";

  const label = (t.status as unknown as Record<string, string>)[status] ?? status;

  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * Payment status.
 *
 * Separate from `StatusBadge` because "PENDING" means different things in the
 * two lifecycles — an owner awaiting review versus a deposit awaiting payment —
 * and they need different words. The dictionary keys the payment one as
 * `PAYMENT_PENDING` so the two can't collide.
 */
export function PaymentBadge({ status }: { status: string }) {
  const t = useT();

  const key = status === "PENDING" ? "PAYMENT_PENDING" : status;
  const label = (t.status as unknown as Record<string, string>)[key] ?? status;

  const tone: BadgeTone =
    status === "PAID"
      ? "ok"
      : status === "PENDING"
        ? "gold"
        : status === "NONE"
          ? "sand"
          : "busy";

  return <Badge tone={tone}>{label}</Badge>;
}

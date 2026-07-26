import clsx from "clsx";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/lib/constants";

/** Pill badges from the design system screen ("الشارات"). */

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

/** Booking-request status, so the label/colour pairing is defined once. */
export function StatusBadge({ status }: { status: string }) {
  const tone: BadgeTone =
    status === "CONFIRMED" ? "ok" : status === "NEW" ? "gold" : "busy";
  const label =
    BOOKING_STATUS_LABELS[status as BookingStatus] ?? status;
  return <Badge tone={tone}>{label}</Badge>;
}

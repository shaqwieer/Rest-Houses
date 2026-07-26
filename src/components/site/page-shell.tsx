import type { ReactNode } from "react";

/**
 * Shared chrome for the simple content pages (about, FAQ, policies, privacy).
 *
 * Exists so those four pages don't each re-invent a heading band and body
 * typography, and so an edit to the reading measure or leading applies to all
 * of them at once.
 */

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="relative overflow-hidden bg-night-900">
      <div className="bg-sadu pointer-events-none absolute inset-0 opacity-55" aria-hidden />
      <div className="relative mx-auto max-w-[900px] px-4 py-10 md:px-10 md:py-14">
        <h1 className="m-0 mb-2.5 font-display text-[clamp(24px,4vw,40px)] font-extrabold text-sand-50">
          {title}
        </h1>
        {subtitle && (
          <p className="m-0 max-w-[60ch] text-[15.5px] leading-[1.9] text-sand-100/70">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Long-form Arabic body copy.
 *
 * The generous `leading-[2]` is deliberate: Arabic script has taller ascenders
 * and deeper descenders than Latin, and cramped leading makes a paragraph of it
 * genuinely hard to read. This matches the 2.0 the design specifies for body.
 */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div
      className="
        max-w-[68ch] text-[15.5px] leading-[2] text-ink/86
        [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:font-display [&_h2]:text-[20px] [&_h2]:font-extrabold [&_h2]:text-ink
        [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-display [&_h3]:text-[16.5px] [&_h3]:font-bold [&_h3]:text-ink
        [&_p]:mb-4
        [&_ul]:mb-4 [&_ul]:ps-5 [&_ul]:list-disc
        [&_ol]:mb-4 [&_ol]:ps-5 [&_ol]:list-decimal
        [&_li]:mb-2
        [&_a]:text-bronze [&_a]:underline [&_a]:underline-offset-3
        [&_strong]:font-bold [&_strong]:text-ink
        [&_code]:rounded [&_code]:bg-sand-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]
      "
    >
      {children}
    </div>
  );
}

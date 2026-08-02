"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { setLocaleAction } from "@/app/actions/locale";
import { useLocale } from "@/lib/i18n/provider";
import { LOCALE_LABELS, otherLocale, type Locale } from "@/lib/i18n/config";

/**
 * Language switcher.
 *
 * A two-state toggle rather than a dropdown: there are exactly two languages, so
 * a menu would be one extra tap for no information gain. The button is labelled
 * with the language it switches *to*, written in that language ("English" while
 * Arabic is active), which is the convention that needs no translation to read.
 *
 * After the cookie is written, `router.refresh()` re-fetches the server
 * components so the whole page — including `<html dir>` on the root layout —
 * comes back in the new language. Without it the cookie would be set but the
 * already-rendered tree would stay as it was until the next navigation.
 */
export function LanguageSwitcher({
  tone = "light",
  className,
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const target: Locale = otherLocale(locale);

  function switchTo() {
    startTransition(async () => {
      await setLocaleAction(target);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={switchTo}
      disabled={pending}
      // `lang` on the button itself so a screen reader pronounces the target
      // language's name with that language's phonetics, not the page's.
      lang={target}
      data-testid="language-switcher"
      aria-label={`${LOCALE_LABELS[target]}`}
      className={clsx(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-bold no-underline transition disabled:opacity-50",
        tone === "dark"
          ? "border-gold-500/30 text-gold-300 hover:bg-gold-500/15"
          : "border-line bg-surface text-ink hover:border-gold-500",
        className,
      )}
    >
      {/* A globe, not a flag: a flag names a country, and neither Arabic nor
          English belongs to one country here. `icon-paths.ts` is generated, so
          this reuses a glyph already in the set rather than hand-editing it. */}
      <Icon name="public" size={16} />
      {LOCALE_LABELS[target]}
    </button>
  );
}

import { Icon } from "@/components/ui/icon";
import { localized, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";

export type PickerOption = { id: string; name: string; nameEn: string | null };

/**
 * "Which rest house?"
 *
 * A `<form method="get">` with a select and a button, not a select that submits
 * itself on change: the latter needs JavaScript, and this control is the one
 * thing standing between the operator and the numbers they came for.
 *
 * `period` and any custom dates ride along as hidden inputs, because a GET form
 * REPLACES the query string rather than merging into it — without them,
 * changing the rest house would silently throw the reader back to the default
 * thirty days.
 *
 * Rendered only when there is a choice to make. One rest house needs no picker,
 * and none at all needs a different message entirely.
 */
export function ListingPicker({
  basePath,
  options,
  selected,
  hidden = {},
  t,
  locale,
}: {
  basePath: string;
  options: PickerOption[];
  /** "" for every rest house in scope. */
  selected: string;
  hidden?: Record<string, string>;
  t: Dictionary;
  locale: Locale;
}) {
  if (options.length < 2) return null;

  return (
    <form
      method="get"
      action={basePath}
      className="flex flex-wrap items-end gap-2 rounded-[20px] border border-line bg-surface p-4 shadow-e1"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px] font-semibold text-muted">
        {t.analytics.pickListing}
        <select
          name="listing"
          defaultValue={selected}
          className="w-full rounded-xl border border-line bg-sand-50 px-3 py-2.5 text-[13px] font-semibold text-ink"
        >
          <option value="">{t.analytics.allListings}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {localized(option.name, option.nameEn, locale)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-full bg-night-900 px-4 py-2.5 text-[12.5px] font-bold text-sand-50 transition hover:bg-night-700"
      >
        <Icon name="search" size={15} className="text-gold-300" />
        {t.analytics.apply}
      </button>
    </form>
  );
}

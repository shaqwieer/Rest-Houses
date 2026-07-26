import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { getSettings } from "@/lib/settings";
import { Brand } from "@/components/site/brand";

/**
 * 404.
 *
 * Lives at the app root rather than inside the (site) group so it also catches
 * unmatched /admin and /login paths. That means it can't use the site layout's
 * header/footer, so it renders its own minimal brand row.
 */
export default async function NotFound() {
  const settings = await getSettings();

  return (
    <div className="flex min-h-screen flex-col bg-sand-50">
      <div className="border-b border-line bg-surface px-4 py-3.5 md:px-10">
        <Brand settings={settings} size="md" />
      </div>

      <main className="grid flex-1 place-items-center px-4 py-14">
        <div className="max-w-[46ch] text-center">
          <div className="mx-auto mb-6 grid size-24 place-items-center rounded-full bg-sand-100">
            <Icon name="travel_explore" size={48} className="text-sand-400" />
          </div>

          <h1 className="m-0 mb-3 font-display text-[clamp(24px,4vw,34px)] font-extrabold text-ink">
            الصفحة غير موجودة
          </h1>
          <p className="m-0 mb-7 text-[15px] leading-[1.9] text-muted">
            الرابط الذي وصلت منه قد يكون قديمًا، أو أن الاستراحة أُزيلت من الموقع.
          </p>

          <div className="flex flex-wrap justify-center gap-2.5">
            <Link
              href="/listings"
              className="inline-flex items-center gap-2 rounded-full bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-6 py-3.5 font-display text-[15px] font-extrabold text-night-900 no-underline shadow-gold hover:no-underline"
            >
              <Icon name="search" size={19} />
              تصفّح الاستراحات
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-6 py-3.5 text-[15px] font-bold text-ink no-underline hover:border-gold-500 hover:no-underline"
            >
              الصفحة الرئيسية
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

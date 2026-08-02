import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LoginForm } from "@/components/admin/login-form";
import { Brand } from "@/components/site/brand";
import { Icon } from "@/components/ui/icon";
import { auth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.nav.ownerLogin,
    robots: { index: false, follow: false },
  };
}

/**
 * Admin login.
 *
 * Keeps the design's split screen — brand story on the dark half, form on the
 * light half — but the *mechanism* is email + password via NextAuth credentials
 * as specified, not the prototype's phone + OTP demo. A WhatsApp OTP would need
 * a Business API account and a message-template approval; the split panel's
 * feature list has been reworded accordingly rather than promising a flow that
 * isn't there.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/admin";

  // Already signed in — skip the form.
  if (session?.user) redirect(next.startsWith("/") ? next : "/admin");

  const [settings, { t }] = await Promise.all([getSettings(), getI18n()]);

  return (
    <main className="flex min-h-screen flex-wrap items-stretch bg-sand-50">
      {/* ---- brand panel (desktop only) ---- */}
      <div className="relative hidden overflow-hidden bg-night-900 p-8 lg:flex lg:min-w-85 lg:flex-1 lg:basis-[46%] lg:flex-col lg:justify-between lg:p-14">
        <div className="bg-sadu pointer-events-none absolute inset-0 opacity-60" aria-hidden />

        <div className="relative">
          <div className="mb-9">
            <Brand settings={settings} tone="dark" size="lg" href={null} />
            <div className="mt-1 text-[11.5px] text-sand-100/50">{t.auth.ownerPortal}</div>
          </div>
          <h1 className="m-0 mb-3.5 max-w-[20ch] font-display text-[clamp(24px,3vw,36px)] font-extrabold leading-[1.35] text-sand-50">
            {t.auth.ownerPortalTitle}
          </h1>
          <p className="m-0 max-w-[40ch] text-[15px] leading-[1.95] text-sand-100/65">
            {t.auth.ownerPortalBody}
          </p>
        </div>

        <ul className="relative m-0 flex list-none flex-col gap-3.5 p-0 pt-8">
          {[
            { icon: "bolt" as const, text: t.auth.ownerPortalPoint1 },
            { icon: "event_busy" as const, text: t.auth.ownerPortalPoint2 },
            { icon: "chat" as const, text: t.auth.ownerPortalPoint3 },
          ].map((f) => (
            <li key={f.text} className="flex items-center gap-3">
              <Icon name={f.icon} size={22} className="text-gold-500" />
              <span className="text-[13.5px] text-sand-100/72">{f.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ---- form panel ---- */}
      <div className="flex flex-1 basis-[54%] flex-col justify-center px-4 py-8 sm:px-8 md:px-13">
        <div className="mx-auto w-full max-w-105">
          {/* brand repeats here on small screens, where the dark panel is hidden */}
          <div className="mb-6.5 lg:hidden">
            <Brand settings={settings} size="md" href={null} />
            <div className="mt-1 text-[11.5px] text-muted">{t.auth.ownerPortal}</div>
          </div>

          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-gold-100 px-3.5 py-1.5 text-[12px] font-bold text-bronze">
            <Icon name="lock_open" size={16} />
            {t.auth.loginSubtitle}
          </div>

          <h2 className="m-0 mb-2 font-display text-[clamp(22px,2.6vw,28px)] font-extrabold text-ink">
            {t.auth.loginTitle}
          </h2>
          <p className="m-0 mb-6.5 text-[14.5px] leading-[1.85] text-muted">
            {t.auth.loginHint}
          </p>

          <LoginForm next={next} />

          <Link
            href="/"
            className="mx-auto mt-7 flex w-fit items-center gap-2 text-[13px] font-semibold text-muted no-underline hover:text-bronze hover:no-underline"
          >
            <Icon name="public" size={17} />
            {t.auth.backToSite}
          </Link>
        </div>
      </div>
    </main>
  );
}

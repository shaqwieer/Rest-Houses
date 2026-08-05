"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { Field, TextInput } from "@/components/ui/field";
import { loginAction } from "@/app/actions/auth";
import { useT } from "@/lib/i18n/provider";

/** Email + password sign-in. Styling follows the design's login fields. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);

    startTransition(async () => {
      const result = await loginAction(formData);
      if (result.ok) {
        // `router.refresh()` first so the server components behind /admin see
        // the new session cookie; without it the dashboard can render once as
        // unauthenticated and bounce back to the login page.
        router.refresh();
        router.replace(result.redirectTo);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      {/* One field, both kinds of account: an owner signs in with the phone
          number they registered, the operator with an email address.

          `type="text"`, emphatically not `type="email"` — the browser refuses
          to submit a phone number from an email input, which would have made
          every owner's login fail before the request left the page. The server
          tells the two apart by looking for an "@". */}
      <Field label={t.auth.identifier} required hint={t.auth.identifierHint}>
        <span className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 focus-within:border-gold-500 focus-within:shadow-[0_0_0_3px_var(--gold-100)]">
          <Icon name="person" size={20} className="text-gold-600" />
          <input
            name="identifier"
            type="text"
            dir="ltr"
            required
            autoComplete="username"
            placeholder="971503322119"
            className="min-w-0 flex-1 border-0 bg-transparent py-4 text-end text-[16px] font-semibold text-ink outline-none placeholder:text-off"
          />
        </span>
      </Field>

      <Field label={t.auth.password} required>
        <span className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 focus-within:border-gold-500 focus-within:shadow-[0_0_0_3px_var(--gold-100)]">
          <Icon name="lock" size={20} className="text-gold-600" />
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            dir="ltr"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="min-w-0 flex-1 border-0 bg-transparent py-4 text-end text-[16px] font-semibold text-ink outline-none placeholder:text-off"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
            className="text-muted transition hover:text-bronze"
          >
            <Icon name={showPassword ? "visibility_off" : "visibility"} size={20} />
          </button>
        </span>
      </Field>

      {error && (
        <p
          role="alert"
          className="m-0 flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-3 text-[13px] font-semibold text-busy"
        >
          <Icon name="error" size={18} />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-linear-[140deg,var(--gold-500),var(--gold-600)] p-4.5 font-display text-[16px] font-extrabold text-night-900 shadow-gold transition hover:brightness-105 active:translate-y-px disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? t.auth.checking : t.auth.enterDashboard}
        {!pending && <Icon name="login" size={20} />}
      </button>
    </form>
  );
}

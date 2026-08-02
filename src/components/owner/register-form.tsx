"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { registerOwner } from "@/app/actions/owners";
import { useLocale } from "@/lib/i18n/provider";
import { CITIES, label } from "@/lib/constants";

/**
 * Owner registration form.
 *
 * On success it shows a confirmation panel rather than redirecting: the owner
 * has just been told their request is pending review, and bouncing them to a
 * login form immediately would bury that. They sign in when they want to check
 * on it.
 *
 * Every field is re-validated on the server (`registerOwner`); the `required`
 * attributes here are only to save a round-trip on obvious omissions.
 */
export function OwnerRegisterForm() {
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();

  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await registerOwner(formData);
      if (result.ok) {
        setDone(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-[28px] border border-line bg-surface p-7 text-center shadow-e1 md:p-10">
        <Icon name="check_circle" size={54} className="mx-auto text-ok" />
        <h2 className="mt-4 mb-2 font-display text-[20px] font-extrabold text-ink">
          {t.owner.statusPendingTitle}
        </h2>
        <p className="mx-auto m-0 mb-6 max-w-[46ch] text-[14.5px] leading-[1.85] text-muted">
          {t.owner.statusPendingBody}
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-full bg-night-900 px-6 py-3 text-[14px] font-bold text-sand-100 no-underline hover:bg-night-700 hover:no-underline"
        >
          <Icon name="login" size={18} />
          {t.auth.signIn}
        </Link>
      </div>
    );
  }

  const sectionHeading = (n: string, text: string) => (
    <div className="mb-3.5 flex items-center gap-2 font-display text-[15.5px] font-extrabold text-ink">
      <span className="grid size-6 place-items-center rounded-lg bg-gold-100 text-[12px] font-extrabold text-bronze">
        {n}
      </span>
      {text}
    </div>
  );

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-[28px] border border-line bg-surface p-5 shadow-e1 md:p-7"
    >
      {error && (
        <p
          role="alert"
          className="m-0 flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-3 text-[13px] font-semibold text-busy"
        >
          <Icon name="error" size={18} />
          {error}
        </p>
      )}

      {/* ---- account ---- */}
      <div>
        {sectionHeading(locale === "ar" ? "١" : "1", t.owner.accountSection)}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.owner.fullName} required error={fieldErrors.fullName}>
            <TextInput
              name="fullName"
              placeholder={t.owner.fullNamePlaceholder}
              autoComplete="name"
              required
              invalid={Boolean(fieldErrors.fullName)}
            />
          </Field>

          <Field label={t.owner.email} required error={fieldErrors.email}>
            <TextInput
              name="email"
              type="email"
              // Latin and LTR regardless of page direction: an email address is
              // an ASCII identifier, and mirroring it makes it unreadable.
              dir="ltr"
              placeholder="name@example.com"
              autoComplete="email"
              required
              invalid={Boolean(fieldErrors.email)}
            />
          </Field>

          <Field label={t.owner.phone} required error={fieldErrors.phone}>
            <TextInput
              name="phone"
              type="tel"
              dir="ltr"
              inputMode="tel"
              placeholder="+971 5X XXX XXXX"
              autoComplete="tel"
              required
              invalid={Boolean(fieldErrors.phone)}
            />
          </Field>

          <Field
            label={t.owner.whatsapp}
            required
            error={fieldErrors.whatsapp}
            hint={t.owner.whatsappHint}
          >
            <TextInput
              name="whatsapp"
              type="tel"
              dir="ltr"
              inputMode="tel"
              placeholder="+971 5X XXX XXXX"
              required
              invalid={Boolean(fieldErrors.whatsapp)}
            />
          </Field>

          <Field
            label={t.owner.password}
            required
            error={fieldErrors.password}
            hint={t.owner.passwordHint}
          >
            <TextInput
              name="password"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              minLength={8}
              required
              invalid={Boolean(fieldErrors.password)}
            />
          </Field>

          <Field
            label={t.owner.confirmPassword}
            required
            error={fieldErrors.confirmPassword}
          >
            <TextInput
              name="confirmPassword"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              minLength={8}
              required
              invalid={Boolean(fieldErrors.confirmPassword)}
            />
          </Field>
        </div>
      </div>

      <div className="h-px bg-line" />

      {/* ---- business ---- */}
      <div>
        {sectionHeading(locale === "ar" ? "٢" : "2", t.owner.businessSection)}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.owner.businessName} error={fieldErrors.businessName}>
            <TextInput
              name="businessName"
              placeholder={t.owner.businessNamePlaceholder}
              invalid={Boolean(fieldErrors.businessName)}
            />
          </Field>

          <Field label={t.owner.city} error={fieldErrors.city}>
            <Select name="city" defaultValue="" invalid={Boolean(fieldErrors.city)}>
              <option value="">{t.common.none}</option>
              {CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c, locale)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t.owner.idNumber}
            error={fieldErrors.idNumber}
            hint={t.owner.idNumberHint}
            className="sm:col-span-2"
          >
            <TextInput
              name="idNumber"
              dir="ltr"
              invalid={Boolean(fieldErrors.idNumber)}
            />
          </Field>
        </div>

        <Field label={t.owner.about} className="mt-3" error={fieldErrors.about}>
          <TextArea name="about" rows={4} placeholder={t.owner.aboutPlaceholder} />
        </Field>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-linear-[140deg,var(--gold-500),var(--gold-600)] p-4.5 font-display text-[16px] font-extrabold text-night-900 shadow-gold transition hover:brightness-105 active:translate-y-px disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? (
          <>
            <Icon name="schedule" size={22} />
            {t.owner.submittingRegistration}
          </>
        ) : (
          <>
            <Icon name="send" size={22} />
            {t.owner.submitRegistration}
          </>
        )}
      </button>

      <p className="m-0 text-center text-[13px] text-muted">
        {t.auth.haveAccount}{" "}
        <Link href="/login" className="font-bold text-bronze">
          {t.auth.loginHere}
        </Link>
      </p>
    </form>
  );
}

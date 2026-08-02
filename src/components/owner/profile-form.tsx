"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { saveOwnerProfile } from "@/app/actions/owner-profile";
import { useLocale } from "@/lib/i18n/provider";
import { CITIES, label } from "@/lib/constants";
import { arFullDate } from "@/lib/dates";

/**
 * Owner profile form.
 *
 * Note what is NOT here: account status, membership expiry, rejection reason.
 * Those are the admin's decisions about this owner, and the server action
 * ignores them even if they are posted — see the note on `saveOwnerProfile`.
 * Membership is shown read-only so the owner knows where they stand without
 * being able to move the date.
 *
 * The email is read-only too: it is the account's login identifier, and changing
 * it is an account-recovery flow rather than a profile edit.
 */
export function OwnerProfileForm({
  profile,
}: {
  profile: {
    fullName: string;
    email: string;
    phone: string;
    whatsapp: string;
    businessName: string;
    city: string;
    about: string;
    /** ISO "YYYY-MM-DD", or null for an open-ended membership. */
    membershipExpiresAt: string | null;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setErrors({});

    startTransition(async () => {
      const result = await saveOwnerProfile(formData);
      if (result.ok) {
        toast(result.message ?? t.common.saved);
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        toast(result.error, "error");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-[28px] border border-line bg-surface p-4 shadow-e1 md:p-5"
    >
      {/* membership — read-only status, not an editable field */}
      <div className="flex items-center gap-3 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3">
        <Icon name="badge" size={20} className="text-bronze" />
        <span className="flex-1">
          <span className="block text-[12px] font-bold text-bronze">
            {t.owner.membershipExpiry}
          </span>
          <span className="block text-[14px] font-bold text-ink">
            {profile.membershipExpiresAt
              ? t.owner.membershipActive(arFullDate(profile.membershipExpiresAt, locale))
              : t.owner.membershipNone}
          </span>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.owner.fullName} required error={errors.fullName}>
          <TextInput
            name="fullName"
            defaultValue={profile.fullName}
            required
            invalid={Boolean(errors.fullName)}
          />
        </Field>

        <Field label={t.owner.email} hint={t.owner.emailReadOnlyHint}>
          <TextInput value={profile.email} dir="ltr" readOnly disabled />
        </Field>

        <Field label={t.owner.phone} required error={errors.phone}>
          <TextInput
            name="phone"
            type="tel"
            dir="ltr"
            inputMode="tel"
            defaultValue={profile.phone}
            required
            invalid={Boolean(errors.phone)}
          />
        </Field>

        <Field
          label={t.owner.whatsapp}
          required
          hint={t.owner.whatsappHint}
          error={errors.whatsapp}
        >
          <TextInput
            name="whatsapp"
            type="tel"
            dir="ltr"
            inputMode="tel"
            defaultValue={profile.whatsapp}
            required
            invalid={Boolean(errors.whatsapp)}
          />
        </Field>

        <Field label={t.owner.businessName} error={errors.businessName}>
          <TextInput
            name="businessName"
            defaultValue={profile.businessName}
            placeholder={t.owner.businessNamePlaceholder}
          />
        </Field>

        <Field label={t.owner.city} error={errors.city}>
          <Select name="city" defaultValue={profile.city}>
            <option value="">{t.common.none}</option>
            {CITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c, locale)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={t.owner.about} error={errors.about}>
        <TextArea
          name="about"
          rows={4}
          defaultValue={profile.about}
          placeholder={t.owner.aboutPlaceholder}
        />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="rounded-2xl bg-night-900 p-4 font-display text-[15px] font-extrabold text-sand-50 shadow-e2 transition hover:bg-night-700 disabled:opacity-60"
      >
        {pending ? t.common.saving : t.common.save}
      </button>
    </form>
  );
}

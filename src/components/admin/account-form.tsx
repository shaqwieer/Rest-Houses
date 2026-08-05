"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { Field, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { changeAdminPassword, updateAdminProfile } from "@/app/actions/admin-account";
import { useLocale } from "@/lib/i18n/provider";

/**
 * The operator's own details and password.
 *
 * ─── Two forms, not one ──────────────────────────────────────────────────────
 * They are separate `<form>` elements with separate submit buttons because they
 * are separate decisions with different consequences: renaming yourself is
 * routine, changing the credential you sign in with is not, and the second
 * needs your current password while the first does not. One combined form would
 * mean either asking for the current password to fix a typo in a name, or not
 * asking for it at all — and the second of those is the account-takeover hole
 * this whole action exists to close.
 *
 * Field errors are held per form for the same reason. A wrong current password
 * must not paint an error under the name field of the panel above it.
 */
export function AdminAccountForm({
  account,
}: {
  account: { name: string; email: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLocale();
  const [pending, startTransition] = useTransition();

  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  // The password inputs are controlled so they can be cleared on success —
  // leaving a just-used password sitting in three boxes on a screen someone may
  // walk away from is the kind of small thing that undoes the rest of this.
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);

  function onSaveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setDetailErrors({});

    startTransition(async () => {
      const result = await updateAdminProfile(formData);
      toast(result.ok ? (result.message ?? t.common.saved) : result.error, result.ok ? "ok" : "error");
      if (result.ok) {
        // The header greets the operator by name and the layout renders it, so
        // a refresh is what makes the change visible without a reload.
        router.refresh();
      } else {
        setDetailErrors(result.fieldErrors ?? {});
      }
    });
  }

  function onChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordErrors({});

    startTransition(async () => {
      const result = await changeAdminPassword(currentPassword, password, confirmPassword);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) {
        setCurrentPassword("");
        setPassword("");
        setConfirmPassword("");
        setShowPasswords(false);
      } else {
        setPasswordErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ---- details ---- */}
      <form
        onSubmit={onSaveDetails}
        className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-5 shadow-e1"
      >
        <SectionHeading icon="badge" title={t.admin.accountDetails} />

        <Field label={t.owner.fullName} required error={detailErrors.name}>
          <TextInput
            name="name"
            defaultValue={account.name}
            required
            invalid={Boolean(detailErrors.name)}
          />
        </Field>

        <Field
          label={t.auth.email}
          required
          hint={t.admin.accountEmailHint}
          error={detailErrors.email}
        >
          <TextInput
            name="email"
            type="email"
            dir="ltr"
            defaultValue={account.email}
            required
            autoComplete="email"
            invalid={Boolean(detailErrors.email)}
            className="text-end"
          />
        </Field>

        <SubmitButton pending={pending} icon="save" label={t.common.save} />
      </form>

      {/* ---- password ---- */}
      <form
        onSubmit={onChangePassword}
        className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-5 shadow-e1"
      >
        <SectionHeading icon="lock" title={t.admin.accountPassword} />

        <p className="m-0 rounded-xl bg-gold-100 px-3 py-2.5 text-[11.5px] leading-relaxed text-bronze">
          {t.admin.accountPasswordNote}
        </p>

        <Field
          label={t.admin.currentPassword}
          required
          error={passwordErrors.currentPassword}
        >
          <TextInput
            type={showPasswords ? "text" : "password"}
            dir="ltr"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
            invalid={Boolean(passwordErrors.currentPassword)}
          />
        </Field>

        <Field
          label={t.admin.newPassword}
          required
          hint={t.owner.passwordHint}
          error={passwordErrors.password}
        >
          <TextInput
            type={showPasswords ? "text" : "password"}
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
            invalid={Boolean(passwordErrors.password)}
          />
        </Field>

        <Field
          label={t.owner.confirmPassword}
          required
          error={passwordErrors.confirmPassword}
        >
          <TextInput
            type={showPasswords ? "text" : "password"}
            dir="ltr"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
            invalid={Boolean(passwordErrors.confirmPassword)}
          />
        </Field>

        <button
          type="button"
          onClick={() => setShowPasswords((v) => !v)}
          className="flex items-center gap-1.5 self-start text-[12px] font-semibold text-muted transition hover:text-bronze"
        >
          <Icon name={showPasswords ? "visibility_off" : "visibility"} size={16} />
          {showPasswords ? t.auth.hidePassword : t.auth.showPassword}
        </button>

        <SubmitButton pending={pending} icon="lock" label={t.admin.changePassword} />
      </form>
    </div>
  );
}

function SectionHeading({ icon, title }: { icon: "badge" | "lock"; title: string }) {
  return (
    <div className="flex items-center gap-2 font-display text-[15.5px] font-extrabold text-ink">
      <span className="grid size-8 place-items-center rounded-xl bg-gold-100 text-bronze">
        <Icon name={icon} size={18} />
      </span>
      {title}
    </div>
  );
}

function SubmitButton({
  pending,
  icon,
  label,
}: {
  pending: boolean;
  icon: "save" | "lock";
  label: string;
}) {
  const { t } = useLocale();

  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-auto flex items-center justify-center gap-2 rounded-2xl bg-linear-[140deg,var(--gold-500),var(--gold-600)] p-3.5 font-display text-[14.5px] font-extrabold text-night-900 shadow-gold transition hover:brightness-105 active:translate-y-px disabled:cursor-wait disabled:opacity-70"
    >
      <Icon name={pending ? "schedule" : icon} size={19} />
      {pending ? t.common.saving : label}
    </button>
  );
}

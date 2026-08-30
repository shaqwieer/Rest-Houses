"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { startBookingCheckout, startLinkCheckout } from "@/app/actions/payments";
import type { PaymentProviderId } from "@/lib/constants";
import { useLocale } from "@/lib/i18n/provider";

/**
 * "How do you want to pay?" — the one interactive part of both payment
 * surfaces.
 *
 * Used from two places with two different authorisations, which is why it takes
 * exactly one of `token` or `reference` and picks its action from that:
 *
 *   token      the payment link page (/pay/<token>). The 64-hex token IS the
 *              authorisation, and it resolves to one booking and one amount.
 *   reference  the booking confirmation page. The guest is paying the booking
 *              they have just made and are already looking at.
 *
 * ─── What this component is allowed to send ─────────────────────────────────
 * The token or reference it was rendered with, and the gateway the guest
 * picked. That is the whole payload. There is no amount field, hidden or
 * otherwise, because the actions have no amount parameter to receive one
 * through — the figure is read from the database server-side. A tampered form
 * can therefore choose a gateway, which is what the buttons already offer, and
 * nothing else.
 *
 * The chosen gateway is still re-validated server-side against what is actually
 * enabled: this list was rendered when the page loaded, and an operator can
 * switch a provider off in between.
 *
 * ─── The redirect ───────────────────────────────────────────────────────────
 * The action returns a checkout URL rather than redirecting itself. The URL is
 * on the provider's domain, and a server-side redirect out of a server action to
 * a third party is both harder to reason about and harder to instrument.
 * Assigning `location.href` here also keeps the pending state on screen until
 * the browser actually leaves, so a slow gateway looks like loading rather than
 * like a dead button.
 */
export function CheckoutChoice({
  providers,
  token,
  reference,
}: {
  providers: PaymentProviderId[];
  token?: string;
  reference?: string;
}) {
  const { t } = useLocale();
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState<PaymentProviderId>(providers[0]);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);

  const label: Record<string, string> = {
    TELR: t.payments.providerTELR,
    TABBY: t.payments.providerTABBY,
    TAMARA: t.payments.providerTAMARA,
  };

  function onSubmit(formData: FormData) {
    setError("");
    startTransition(async () => {
      const result = token
        ? await startLinkCheckout(formData)
        : await startBookingCheckout(formData);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.url) {
        // Held true for the rest of this page's life — the browser is on its
        // way out, and re-enabling the button would offer a second checkout
        // against a link that has already been spent.
        setLeaving(true);
        window.location.href = result.url;
      }
    });
  }

  if (leaving) {
    return (
      <div className="rounded-[20px] border border-line bg-sand-100 p-5 text-center text-[13px] text-muted">
        {t.payments.payRedirecting}
      </div>
    );
  }

  return (
    <form action={onSubmit}>
      {token && <input type="hidden" name="token" value={token} />}
      {reference && <input type="hidden" name="reference" value={reference} />}
      <input type="hidden" name="provider" value={provider} />

      {/* Only rendered when there is a choice to make. One gateway needs no
          radio group, and a single unselectable option reads as broken. */}
      {providers.length > 1 && (
        <>
          <span className="mb-2 block text-[12.5px] font-bold text-ink">
            {t.payments.payProvider}
          </span>
          <div className="mb-4 grid gap-2">
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                aria-pressed={provider === p}
                className={clsx(
                  "flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-start text-[13.5px] font-bold transition",
                  provider === p
                    ? "border-gold-500 bg-gold-100 text-bronze"
                    : "border-line bg-surface text-ink hover:border-gold-500/50",
                )}
              >
                <Icon
                  name={provider === p ? "check_circle" : "credit_card"}
                  size={18}
                  className={provider === p ? "text-bronze" : "text-muted"}
                />
                {label[p] ?? p}
              </button>
            ))}
          </div>
        </>
      )}

      {error && (
        <p className="mb-3 flex items-start gap-1.5 rounded-2xl bg-busy-bg px-3.5 py-2.5 text-[12.5px] text-busy">
          <Icon name="error" size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? t.payments.payRedirecting : t.payments.payNow}
      </Button>
    </form>
  );
}

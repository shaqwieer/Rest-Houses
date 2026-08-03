"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { moderateReview } from "@/app/actions/reviews";
import { useLocale } from "@/lib/i18n/provider";

/**
 * Approve / reject controls for one pending review.
 *
 * Split out of the page purely so the table stays a server component: the two
 * buttons are the only interactive part of it, and a client boundary drawn here
 * keeps the query, the formatting and the review text on the server.
 */
export function ReviewActions({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLocale();
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    startTransition(async () => {
      const result = await moderateReview(reviewId, approve);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => decide(true)}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-xl bg-ok px-3 py-2 text-[12px] font-bold text-white transition hover:brightness-110 disabled:opacity-60"
      >
        <Icon name="check" size={15} />
        {t.admin.reviewApprove}
      </button>
      <button
        type="button"
        onClick={() => decide(false)}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-xl bg-busy-bg px-3 py-2 text-[12px] font-bold text-busy transition hover:bg-[#f0d2cc] disabled:opacity-60"
      >
        <Icon name="close" size={15} />
        {t.admin.reviewReject}
      </button>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { deleteRequest, setRequestStatus } from "@/app/actions/requests";
import { arDayMonth } from "@/lib/dates";
import { arNum, toArabicDigits } from "@/lib/format";

export type RequestCardData = {
  id: string;
  reference: string;
  listingName: string;
  listingSlug: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: number;
  depositDue: number;
  notes: string | null;
  status: string;
  /** Pre-built wa.me link with the owner's reply pre-typed. */
  whatsappHref: string;
};

/** One booking request, with confirm / reject / WhatsApp / delete actions. */
export function RequestCard({ request }: { request: RequestCardData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function act(status: string) {
    startTransition(async () => {
      const result = await setRequestStatus(request.id, status);
      toast(result.ok ? (result.message ?? "تم") : result.error, result.ok ? "ok" : "error");
      if (result.ok) router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteRequest(request.id);
      toast(result.ok ? (result.message ?? "تم") : result.error, result.ok ? "ok" : "error");
      setConfirmingDelete(false);
      if (result.ok) router.refresh();
    });
  }

  const isNew = request.status === "NEW";
  const isConfirmed = request.status === "CONFIRMED";

  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 shadow-e1">
      {/* header */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="font-display text-[15px] font-bold text-ink">{request.customerName}</div>
          <div className="mt-0.5 truncate text-[12px] text-muted">
            <span dir="ltr">{toArabicDigits(request.reference)}</span> ·{" "}
            <Link
              href={`/listings/${encodeURIComponent(request.listingSlug)}`}
              target="_blank"
              className="text-muted no-underline hover:text-bronze hover:no-underline"
            >
              {request.listingName}
            </Link>
          </div>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {/* facts */}
      <div className="grid grid-cols-3 gap-2">
        <Cell label="التواريخ" value={`${arDayMonth(request.checkIn)} – ${arDayMonth(request.checkOut)}`} />
        <Cell label="الضيوف" value={arNum(request.guests)} />
        <Cell label="الإجمالي" value={`${arNum(request.total)} د.إ`} />
      </div>

      {/* contact — tappable on a phone, which is the point */}
      <div className="flex flex-wrap gap-3 text-[12.5px]">
        <a
          href={`tel:${request.customerPhone}`}
          dir="ltr"
          className="flex items-center gap-1.5 font-semibold text-bronze no-underline hover:no-underline"
        >
          <Icon name="call" size={15} />
          {request.customerPhone}
        </a>
        {request.customerEmail && (
          <a
            href={`mailto:${request.customerEmail}`}
            dir="ltr"
            className="flex items-center gap-1.5 text-muted no-underline hover:text-bronze hover:no-underline"
          >
            <Icon name="mail" size={15} />
            {request.customerEmail}
          </a>
        )}
      </div>

      {request.notes && (
        <p className="m-0 rounded-xl bg-gold-100 px-3 py-2.5 text-[12.5px] leading-relaxed text-bronze">
          {request.notes}
        </p>
      )}

      {isConfirmed && (
        <p className="m-0 flex items-center gap-2 rounded-xl bg-ok-bg px-3 py-2.5 text-[12px] font-semibold text-ok">
          <Icon name="event_available" size={16} />
          التواريخ محجوزة في التقويم · العربون {arNum(request.depositDue)} د.إ
        </p>
      )}

      {/* actions */}
      <div className="flex items-center gap-2">
        <a
          href={request.whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          title="مراسلة العميل على الواتساب"
          aria-label="مراسلة العميل على الواتساب"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-wa text-wa-ink no-underline transition hover:brightness-105 hover:no-underline"
        >
          <Icon name="chat" size={20} />
        </a>

        {isNew ? (
          <>
            <button
              type="button"
              onClick={() => act("CONFIRMED")}
              disabled={pending}
              className="flex-1 rounded-xl bg-ok p-3 text-[13.5px] font-bold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              تأكيد
            </button>
            <button
              type="button"
              onClick={() => act("REJECTED")}
              disabled={pending}
              className="rounded-xl bg-busy-bg px-4.5 py-3 text-[13.5px] font-bold text-busy transition hover:bg-[#f0d2cc] disabled:opacity-60"
            >
              رفض
            </button>
          </>
        ) : (
          <>
            {isConfirmed && (
              <button
                type="button"
                onClick={() => act("CANCELLED")}
                disabled={pending}
                className="flex-1 rounded-xl border border-line bg-surface p-3 text-[13px] font-bold text-ink transition hover:border-busy hover:text-busy disabled:opacity-60"
              >
                إلغاء الحجز وتحرير التواريخ
              </button>
            )}
            {!isConfirmed && (
              <button
                type="button"
                onClick={() => act("NEW")}
                disabled={pending}
                className="flex-1 rounded-xl border border-line bg-surface p-3 text-[13px] font-bold text-ink transition hover:border-gold-500 disabled:opacity-60"
              >
                إعادة إلى الانتظار
              </button>
            )}
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              title="حذف الطلب"
              aria-label="حذف الطلب"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-busy-bg text-busy disabled:opacity-60"
            >
              <Icon name="delete" size={18} />
            </button>
          </>
        )}
      </div>

      {confirmingDelete && (
        <div className="fixed inset-0 z-300 grid place-items-center bg-night-900/60 p-4 backdrop-blur-sm">
          <div className="animate-pop-in w-full max-w-90 rounded-[24px] border border-line bg-surface p-5 shadow-e2">
            <h2 className="m-0 mb-2 text-center font-display text-[16px] font-extrabold text-ink">
              حذف الطلب <span dir="ltr">{toArabicDigits(request.reference)}</span>؟
            </h2>
            <p className="m-0 mb-4 text-center text-[13px] text-muted">
              لا يمكن التراجع عن هذه الخطوة.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="flex-1 rounded-2xl bg-busy p-3.5 text-[14px] font-bold text-white disabled:opacity-60"
              >
                حذف
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14px] font-bold text-ink"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-sand-50 px-2.5 py-2">
      <span className="mb-0.5 block text-[10.5px] text-muted">{label}</span>
      <span className="block text-[12.5px] font-bold text-ink">{value}</span>
    </div>
  );
}

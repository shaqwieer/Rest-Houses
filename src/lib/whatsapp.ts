import { arFullDate, type ISODate } from "./dates";
import { arNum, whatsappDigits } from "./format";

/**
 * WhatsApp deep links.
 *
 * `https://wa.me/<digits>?text=<urlencoded message>` opens the native app (or
 * WhatsApp Web on desktop) with the message pre-typed but NOT sent — the guest
 * still presses send, which is what keeps this compliant and spam-free.
 *
 * The number always comes from site settings (or the listing's own owner
 * number), never a constant, so changing it in /admin/settings changes every
 * link on the site at once.
 */

/** Bare link with no message — used by "call us" style affordances. */
export function whatsappLink(number: string, message?: string): string {
  const digits = whatsappDigits(number);
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export type BookingMessageInput = {
  siteName: string;
  reference: string;
  listingName: string;
  listingArea?: string | null;
  listingUrl?: string;
  checkIn: ISODate;
  checkOut: ISODate;
  nights: number;
  guests: number;
  customerName: string;
  customerPhone: string;
  total: number;
  notes?: string | null;
};

/**
 * The prefilled Arabic booking-request message.
 *
 * Written as explicit lines rather than a paragraph because WhatsApp preserves
 * newlines: the owner can read dates and guest count at a glance on a phone.
 * `‏` (RIGHT-TO-LEFT MARK) prefixes lines that begin with a Latin/numeric
 * token so a line like "+971 50…" doesn't get visually reordered inside an
 * otherwise RTL paragraph.
 */
export function bookingRequestMessage(input: BookingMessageInput): string {
  const RLM = "‏";
  const lines: string[] = [
    `${RLM}السلام عليكم 👋`,
    `${RLM}أرغب بحجز *${input.listingName}*${input.listingArea ? ` — ${input.listingArea}` : ""}`,
    "",
    `${RLM}📋 رقم الطلب: ${input.reference}`,
    `${RLM}📅 الوصول: ${arFullDate(input.checkIn)}`,
    `${RLM}📅 المغادرة: ${arFullDate(input.checkOut)}`,
    `${RLM}🌙 عدد الليالي: ${arNum(input.nights)}`,
    `${RLM}👥 عدد الضيوف: ${arNum(input.guests)}`,
    `${RLM}💰 الإجمالي التقديري: ${arNum(input.total)} د.إ`,
    "",
    `${RLM}👤 الاسم: ${input.customerName}`,
    `${RLM}📱 الجوال: ${input.customerPhone}`,
  ];

  if (input.notes && input.notes.trim()) {
    lines.push("", `${RLM}📝 ملاحظات: ${input.notes.trim()}`);
  }

  if (input.listingUrl) {
    lines.push("", `${RLM}🔗 ${input.listingUrl}`);
  }

  lines.push("", `${RLM}أرسلت عبر ${input.siteName}`);

  return lines.join("\n");
}

/** Shorter message for the "ask us anything" CTA on the home page. */
export function generalEnquiryMessage(siteName: string): string {
  const RLM = "‏";
  return [
    `${RLM}السلام عليكم 👋`,
    `${RLM}أبحث عن استراحة مناسبة.`,
    `${RLM}التاريخ المطلوب:`,
    `${RLM}عدد الضيوف:`,
    `${RLM}الميزانية التقريبية:`,
    "",
    `${RLM}(من موقع ${siteName})`,
  ].join("\n");
}

/** Owner-side message: replying to a specific request from the admin dashboard. */
export function ownerReplyMessage(input: {
  siteName: string;
  customerName: string;
  reference: string;
  listingName: string;
}): string {
  const RLM = "‏";
  return [
    `${RLM}أهلًا ${input.customerName} 👋`,
    `${RLM}بخصوص طلبك رقم ${input.reference} على *${input.listingName}*:`,
    "",
    `${RLM}${input.siteName}`,
  ].join("\n");
}

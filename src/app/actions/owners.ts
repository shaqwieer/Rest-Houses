"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin, AuthorizationError } from "@/lib/auth";
import { auditData } from "@/lib/audit";
import { emailField, phoneField, whatsappField } from "@/lib/validation";
import { CITIES, isOwnerStatus } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { guardSubmission } from "@/lib/security";
import { toISODate } from "@/lib/dates";
import type { Dictionary } from "@/lib/i18n";
import type { ActionResult } from "./listings";

/**
 * Owner registration and the admin approval workflow.
 *
 * ─── The invariant these actions defend ──────────────────────────────────────
 * A newly registered owner is inert. They can sign in — they have to, to see
 * their status — but they cannot create a listing, cannot publish, and nothing
 * of theirs is visible to the public until an admin approves them. That is
 * enforced by `requireApprovedOwner()` on every owner mutation and by
 * `publicListingWhere()` on every public read, not by hiding buttons.
 *
 * Every state change an admin makes here is written **inside a transaction with
 * its audit row**, so the log can never disagree with the record it describes.
 */

/* -------------------------------------------------------------------------- */
/* Registration (public)                                                      */
/* -------------------------------------------------------------------------- */

const VALID_CITY_IDS = CITIES.map((c) => c.id);

function registrationSchema(t: Dictionary) {
  return z
    .object({
      fullName: z.string().trim().min(3, t.validation.nameTooShort).max(120),
      email: emailField(t),
      // Both numbers go through the shared validators, so what is accepted here
      // is exactly what will produce a working wa.me link later — and, for
      // `phone`, exactly the string this owner will type to sign in. A number
      // that passes validation but can't be linked (or can't be logged in with)
      // is worse than one rejected up front.
      phone: phoneField(t),
      whatsapp: whatsappField(t),
      password: z.string().min(8, t.validation.passwordTooShort).max(200),
      confirmPassword: z.string(),
      businessName: z.string().trim().max(160).default(""),
      idNumber: z.string().trim().max(60).default(""),
      city: z
        .string()
        .trim()
        .default("")
        .refine((v) => v === "" || VALID_CITY_IDS.includes(v), t.validation.invalidCity),
      about: z.string().trim().max(2000).default(""),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t.validation.passwordMismatch,
      path: ["confirmPassword"],
    });
}

export type RegisterOwnerResult =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function registerOwner(formData: FormData): Promise<RegisterOwnerResult> {
  const { t } = await getI18n();

  const parsed = registrationSchema(t).safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    whatsapp: formData.get("whatsapp"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    businessName: formData.get("businessName") ?? "",
    idNumber: formData.get("idNumber") ?? "",
    city: formData.get("city") ?? "",
    about: formData.get("about") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: t.validation.checkFields, fieldErrors };
  }

  const data = parsed.data;

  // --- anti-abuse gate ----------------------------------------------------
  //
  // Registration creates a User row and runs bcrypt, so an ungated form is both
  // a spam surface and a CPU one. The budget here is much tighter than the
  // booking form's: a rest-house owner signs up once, and three attempts an hour
  // from one address already covers every honest retry.
  //
  // Note the ordering — this runs *before* the "is this email taken" lookup, so
  // the endpoint cannot be used to enumerate which addresses have accounts.
  const guard = await guardSubmission({ purpose: "owner-register", formData, t });
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      error: t.validation.emailTaken,
      fieldErrors: { email: t.validation.emailTaken },
    };
  }

  // The phone number is this account's username, so it has to be as unique as
  // the email — and refused the same way, as a field error pointing at the
  // field. Letting the unique index raise P2002 would surface as a generic
  // "couldn't save" with nothing indicating which of the eight inputs was the
  // problem.
  const phoneTaken = await prisma.user.findUnique({
    where: { username: data.phone },
    select: { id: true },
  });
  if (phoneTaken) {
    return {
      ok: false,
      error: t.validation.phoneTaken,
      fieldErrors: { phone: t.validation.phoneTaken },
    };
  }

  // Spent immediately before the write, for the same reason as on the booking
  // form: a registration that bounced off "this email is taken" must be
  // resubmittable with a different address and the token already in hand.
  if (!guard.spend()) {
    return { ok: false, error: t.security.challengeExpired };
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  try {
    // Account, profile and audit row are one atomic unit. A User with no
    // OwnerProfile would be an account that can sign in but has no status to
    // show and no way to reach either dashboard — a dead end that only an
    // operator with database access could clear.
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          // What this owner will actually type to sign in. Set here, at the one
          // moment the account is created, from the same normalised value that
          // goes into `OwnerProfile.phone` below — the two must never disagree.
          username: data.phone,
          name: data.fullName,
          passwordHash,
          role: "OWNER",
        },
      });

      const owner = await tx.ownerProfile.create({
        data: {
          userId: user.id,
          fullName: data.fullName,
          // Both arrive already normalised from the schema, so every consumer
          // gets link-ready digits and no component has to re-parse whatever
          // shape the owner typed. `phone` is also this account's username —
          // see the User row created just above.
          phone: data.phone,
          whatsapp: data.whatsapp,
          businessName: data.businessName,
          idNumber: data.idNumber || null,
          city: data.city,
          about: data.about,
          status: "PENDING",
        },
      });

      await tx.auditLog.create({
        data: auditData({
          // Self-registration: the actor is the new owner, not an admin.
          actor: { id: user.id, email: user.email, role: "OWNER" },
          action: "OWNER_REGISTERED",
          entityType: "OwnerProfile",
          entityId: owner.id,
          summary: data.businessName || data.fullName,
          metadata: { email: data.email, city: data.city },
        }),
      });
    });
  } catch (error) {
    console.error("registerOwner failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }

  revalidatePath("/admin/owners");
  revalidatePath("/admin/owner-requests");
  revalidatePath("/admin");

  return { ok: true, message: t.owner.registrationSuccess };
}

/* -------------------------------------------------------------------------- */
/* Admin review actions                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Paths whose content depends on which owners are eligible.
 *
 * Approving, suspending or expiring an owner changes what the *public* site
 * shows, not just the dashboard — so the public pages are revalidated too.
 * Missing these is how an admin suspends an owner and then finds their listings
 * still on the home page.
 */
function revalidateOwnerSurfaces() {
  revalidatePath("/");
  revalidatePath("/listings");
  revalidatePath("/favorites");
  revalidatePath("/admin");
  revalidatePath("/admin/owners");
  revalidatePath("/admin/owner-requests");
  revalidatePath("/admin/listings");
  revalidatePath("/owner");
}

/** Load the owner an admin action targets, or fail with a translated message. */
async function loadOwner(ownerId: string, t: Dictionary) {
  const owner = await prisma.ownerProfile.findUnique({
    where: { id: ownerId },
    select: {
      id: true,
      fullName: true,
      businessName: true,
      status: true,
      membershipExpiresAt: true,
      user: { select: { id: true, email: true, username: true } },
      _count: { select: { listings: true } },
    },
  });
  if (!owner) return { owner: null, error: t.validation.ownerNotFound };
  return { owner, error: null };
}

/**
 * Approve a pending (or previously rejected) owner.
 *
 * `membershipMonths` sets the initial membership window. It defaults to 12 and
 * may be 0, which means "no expiry" — an open-ended membership, stored as null
 * rather than as a far-future date so the distinction stays legible in the data.
 */
export async function approveOwner(
  ownerId: string,
  membershipMonths = 12,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const { owner, error } = await loadOwner(ownerId, t);
  if (!owner) return { ok: false, error: error! };

  const months = Number.isFinite(membershipMonths)
    ? Math.min(120, Math.max(0, Math.round(membershipMonths)))
    : 12;
  const expiresAt = months > 0 ? addMonths(new Date(), months) : null;

  await prisma.$transaction([
    prisma.ownerProfile.update({
      where: { id: ownerId },
      data: {
        status: "APPROVED",
        // Cleared on approval: a stale reason from an earlier rejection must not
        // keep showing on a now-approved account.
        rejectionReason: null,
        reviewedAt: new Date(),
        reviewedById: admin.id,
        membershipExpiresAt: expiresAt,
      },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor: { id: admin.id, email: admin.email, role: admin.role },
        action: "OWNER_APPROVED",
        entityType: "OwnerProfile",
        entityId: ownerId,
        summary: owner.businessName || owner.fullName,
        metadata: {
          previousStatus: owner.status,
          membershipExpiresAt: expiresAt ? toISODate(expiresAt) : null,
          listingsAffected: owner._count.listings,
        },
      }),
    }),
  ]);

  revalidateOwnerSurfaces();
  return { ok: true, message: t.admin.ownerApproved };
}

/** Reject a registration request, with an optional reason shown to the owner. */
export async function rejectOwner(
  ownerId: string,
  reason?: string,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const { owner, error } = await loadOwner(ownerId, t);
  if (!owner) return { ok: false, error: error! };

  const trimmed = (reason ?? "").trim().slice(0, 1000);

  await prisma.$transaction([
    prisma.ownerProfile.update({
      where: { id: ownerId },
      data: {
        status: "REJECTED",
        rejectionReason: trimmed || null,
        reviewedAt: new Date(),
        reviewedById: admin.id,
      },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor: { id: admin.id, email: admin.email, role: admin.role },
        action: "OWNER_REJECTED",
        entityType: "OwnerProfile",
        entityId: ownerId,
        summary: owner.businessName || owner.fullName,
        metadata: {
          previousStatus: owner.status,
          reason: trimmed,
          listingsAffected: owner._count.listings,
        },
      }),
    }),
  ]);

  revalidateOwnerSurfaces();
  return { ok: true, message: t.admin.ownerRejected };
}

/**
 * Suspend or re-activate an approved owner.
 *
 * Note what this does *not* touch: `Listing.published`. Suspension hides the
 * owner's listings through `publicListingWhere()`, leaving each listing's own
 * published flag exactly as the owner set it — so re-activation restores the
 * ones that were live and leaves the drafts as drafts, with nothing to replay.
 */
export async function setOwnerSuspended(
  ownerId: string,
  suspended: boolean,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const { owner, error } = await loadOwner(ownerId, t);
  if (!owner) return { ok: false, error: error! };

  await prisma.$transaction([
    prisma.ownerProfile.update({
      where: { id: ownerId },
      data: {
        status: suspended ? "SUSPENDED" : "APPROVED",
        reviewedAt: new Date(),
        reviewedById: admin.id,
      },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor: { id: admin.id, email: admin.email, role: admin.role },
        action: suspended ? "OWNER_SUSPENDED" : "OWNER_ACTIVATED",
        entityType: "OwnerProfile",
        entityId: ownerId,
        summary: owner.businessName || owner.fullName,
        metadata: {
          previousStatus: owner.status,
          listingsAffected: owner._count.listings,
        },
      }),
    }),
  ]);

  revalidateOwnerSurfaces();
  return {
    ok: true,
    message: suspended ? t.admin.ownerSuspended : t.admin.ownerActivated,
  };
}

/**
 * Set or clear an owner's membership expiry.
 *
 * An empty string clears it (an open-ended membership). Renewal is the same
 * call with a later date — and because visibility is a query-time predicate,
 * that one write is the entire renewal: every listing the owner had published
 * becomes visible again at its original status, immediately.
 */
export async function setOwnerMembershipExpiry(
  ownerId: string,
  expiresAtISO: string,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const { owner, error } = await loadOwner(ownerId, t);
  if (!owner) return { ok: false, error: error! };

  const raw = (expiresAtISO ?? "").trim();
  let expiresAt: Date | null = null;

  if (raw) {
    // Parsed as UTC midnight, matching how every other calendar day in this app
    // is handled: an expiry "on the 30th" must mean the 30th to everyone, not
    // the 29th to a viewer west of UTC.
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: t.validation.invalidDate };
    }
    expiresAt = parsed;
  }

  await prisma.$transaction([
    prisma.ownerProfile.update({
      where: { id: ownerId },
      data: { membershipExpiresAt: expiresAt },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor: { id: admin.id, email: admin.email, role: admin.role },
        action: "MEMBERSHIP_UPDATED",
        entityType: "OwnerProfile",
        entityId: ownerId,
        summary: owner.businessName || owner.fullName,
        metadata: {
          from: owner.membershipExpiresAt ? toISODate(owner.membershipExpiresAt) : null,
          to: expiresAt ? toISODate(expiresAt) : null,
          listingsAffected: owner._count.listings,
        },
      }),
    }),
  ]);

  revalidateOwnerSurfaces();
  return { ok: true, message: t.admin.membershipUpdated };
}

/* -------------------------------------------------------------------------- */
/* Admin account management                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The fields an admin may rewrite on an owner's account.
 *
 * Deliberately the same shape and the same rules as `registrationSchema`, minus
 * the passwords: a value an admin can save must be a value the owner could have
 * registered with, or the two forms disagree about what a valid WhatsApp number
 * or city id is and the admin form quietly becomes the way to store one the
 * rest of the app can't use.
 *
 * `status`, `membershipExpiresAt` and `rejectionReason` are absent on purpose.
 * Those already have their own audited actions above, each writing a specific
 * log entry; folding them into a general "save details" would blur the record
 * of who suspended whom into "someone edited this owner".
 */
function ownerAccountSchema(t: Dictionary) {
  return z.object({
    fullName: z.string().trim().min(3, t.validation.nameTooShort).max(120),
    email: emailField(t),
    phone: phoneField(t),
    whatsapp: whatsappField(t),
    businessName: z.string().trim().max(160).default(""),
    idNumber: z.string().trim().max(60).default(""),
    city: z
      .string()
      .trim()
      .default("")
      .refine((v) => v === "" || VALID_CITY_IDS.includes(v), t.validation.invalidCity),
    about: z.string().trim().max(2000).default(""),
  });
}

/**
 * Edit an owner's account and business details from /admin/owners.
 *
 * Three things here are easy to get wrong and are each worth naming:
 *
 *   • **The email is unique on User.** A collision has to come back as a field
 *     error, the way registration handles it — letting Prisma raise P2002 would
 *     surface as "save failed" and leave the admin guessing which field.
 *
 *   • **WhatsApp is stored normalised**, through the same helper registration
 *     uses. Storing whatever was typed would produce an owner whose every
 *     `wa.me` link is broken, on all of their listings at once.
 *
 *   • **`fullName` lives in two places** — `OwnerProfile.fullName` and
 *     `User.name` — because registration writes both. They are updated in the
 *     same transaction so they cannot drift apart.
 */
export async function updateOwnerAccount(
  ownerId: string,
  formData: FormData,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const { owner, error } = await loadOwner(ownerId, t);
  if (!owner) return { ok: false, error: error! };

  const parsed = ownerAccountSchema(t).safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    whatsapp: formData.get("whatsapp"),
    businessName: formData.get("businessName") ?? "",
    idNumber: formData.get("idNumber") ?? "",
    city: formData.get("city") ?? "",
    about: formData.get("about") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: t.validation.checkFields, fieldErrors };
  }

  const data = parsed.data;

  // Checked before writing rather than caught after: `id: { not: … }` so an
  // admin saving the form without touching the email is not told their own
  // owner's address is taken.
  if (data.email !== owner.user.email) {
    const clash = await prisma.user.findFirst({
      where: { email: data.email, id: { not: owner.user.id } },
      select: { id: true },
    });
    if (clash) {
      return {
        ok: false,
        error: t.validation.emailTaken,
        fieldErrors: { email: t.validation.emailTaken },
      };
    }
  }

  // The same check on the number, because the number is the username. Editing
  // an owner's phone here MOVES THEIR LOGIN — that is the intended behaviour
  // (an owner who changes their mobile expects to sign in with the new one),
  // and it is why the dialog labels this field as the username.
  if (data.phone !== owner.user.username) {
    const clash = await prisma.user.findFirst({
      where: { username: data.phone, id: { not: owner.user.id } },
      select: { id: true },
    });
    if (clash) {
      return {
        ok: false,
        error: t.validation.phoneTaken,
        fieldErrors: { phone: t.validation.phoneTaken },
      };
    }
  }

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: owner.user.id },
        // `username` moves with the phone number, inside the same transaction
        // as the profile row it is derived from. Split across two writes they
        // could diverge on a failure, leaving an owner whose stored number and
        // whose login are different strings — unrecoverable without database
        // access, because neither screen would show the one that works.
        data: { email: data.email, username: data.phone, name: data.fullName },
      }),
      prisma.ownerProfile.update({
        where: { id: ownerId },
        data: {
          fullName: data.fullName,
          phone: data.phone,
          whatsapp: data.whatsapp,
          businessName: data.businessName,
          idNumber: data.idNumber || null,
          city: data.city,
          about: data.about,
        },
      }),
      prisma.auditLog.create({
        data: auditData({
          actor: { id: admin.id, email: admin.email, role: admin.role },
          action: "OWNER_UPDATED",
          entityType: "OwnerProfile",
          entityId: ownerId,
          summary: data.businessName || data.fullName,
          // What changed, not the whole record — an operator reading the log
          // wants to see that the email moved, not re-read the profile.
          metadata: {
            emailFrom: owner.user.email,
            emailTo: data.email,
            listingsAffected: owner._count.listings,
          },
        }),
      }),
    ]);
  } catch (err) {
    console.error("updateOwnerAccount failed:", err);
    return { ok: false, error: t.validation.saveFailed };
  }

  // The WhatsApp number on every one of this owner's listings resolves through
  // the relation, so editing it here changes the public pages too.
  revalidateOwnerSurfaces();
  return { ok: true, message: t.admin.ownerUpdated };
}

/**
 * Set an owner's password from /admin/owners.
 *
 * The rule that matters: this is the *only* way an admin touches a credential,
 * and the plaintext never leaves this function — not into the audit metadata,
 * not into a log line, not into the result message. The log records that a
 * reset happened, by whom, and to which account.
 *
 * Length limits match `registrationSchema` exactly, so an admin cannot set a
 * password the owner's own sign-in form would reject.
 *
 * ─── What this does and does not invalidate ──────────────────────────────────
 * Sessions are 30-day JWTs with no server-side session table, so an owner who
 * is already signed in stays signed in until their token expires — a reset
 * stops the *old password* working, not an existing session. That is acceptable
 * here because it is not what gates access: whether an owner may act is re-read
 * from the database on every request by `requireApprovedOwner()`, so an admin
 * who needs to cut someone off immediately suspends them, which takes effect on
 * their very next request.
 */
export async function setOwnerPassword(
  ownerId: string,
  password: string,
  confirmPassword: string,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const { owner, error } = await loadOwner(ownerId, t);
  if (!owner) return { ok: false, error: error! };

  const parsed = z
    .object({
      password: z.string().min(8, t.validation.passwordTooShort).max(200),
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t.validation.passwordMismatch,
      path: ["confirmPassword"],
    })
    .safeParse({ password, confirmPassword });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: t.validation.checkFields, fieldErrors };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: owner.user.id },
        data: { passwordHash },
      }),
      prisma.auditLog.create({
        data: auditData({
          actor: { id: admin.id, email: admin.email, role: admin.role },
          action: "OWNER_PASSWORD_RESET",
          entityType: "OwnerProfile",
          entityId: ownerId,
          summary: owner.businessName || owner.fullName,
          // The account it happened to, and nothing about the password itself.
          metadata: { email: owner.user.email },
        }),
      }),
    ]);
  } catch (err) {
    console.error("setOwnerPassword failed:", err);
    return { ok: false, error: t.validation.saveFailed };
  }

  revalidatePath("/admin/owners");
  return { ok: true, message: t.admin.ownerPasswordChanged };
}

/** Set an owner's status directly — used by the status dropdown in the table. */
export async function setOwnerStatus(
  ownerId: string,
  status: string,
): Promise<ActionResult> {
  const { t } = await getI18n();
  if (!isOwnerStatus(status)) return { ok: false, error: t.validation.invalidStatus };

  if (status === "APPROVED") return approveOwner(ownerId);
  if (status === "REJECTED") return rejectOwner(ownerId);
  if (status === "SUSPENDED") return setOwnerSuspended(ownerId, true);

  // PENDING — returning an owner to the review queue.
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return unauthorizedResult(error, t);
  }

  const { owner, error } = await loadOwner(ownerId, t);
  if (!owner) return { ok: false, error: error! };

  await prisma.$transaction([
    prisma.ownerProfile.update({
      where: { id: ownerId },
      data: { status: "PENDING", rejectionReason: null },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor: { id: admin.id, email: admin.email, role: admin.role },
        action: "OWNER_SUSPENDED",
        entityType: "OwnerProfile",
        entityId: ownerId,
        summary: owner.businessName || owner.fullName,
        metadata: { previousStatus: owner.status, newStatus: "PENDING" },
      }),
    }),
  ]);

  revalidateOwnerSurfaces();
  return { ok: true, message: t.admin.membershipUpdated };
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Turn a guard failure into a translated result rather than a 500.
 *
 * Re-thrown if it isn't an authorisation error: swallowing a genuine bug behind
 * "you don't have permission" would make it invisible.
 */
function unauthorizedResult(error: unknown, t: Dictionary): ActionResult {
  if (error instanceof AuthorizationError) {
    return { ok: false, error: t.validation.unauthorized };
  }
  throw error;
}

/**
 * Add whole months to a date, clamped to the end of the target month.
 *
 * `setUTCMonth` alone overflows — 31 January + 1 month becomes 3 March, which
 * would silently hand an owner two extra days of membership. Clamping to the
 * 28th–31st of the intended month is the behaviour a person expects from
 * "twelve months from today".
 */
function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const targetDay = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(targetDay, daysInTargetMonth));
  return d;
}

import type { Prisma } from "@prisma/client";
import type { AuditAction } from "./constants";

/**
 * Audit logging.
 *
 * ─── Why this returns a query instead of writing one ─────────────────────────
 * Every function here builds an *unexecuted* `prisma.auditLog.create(…)` for the
 * caller to drop into its own `$transaction([...])` array, rather than writing
 * the row itself.
 *
 * That is the difference between a log that describes what happened and a log
 * that describes what was attempted. If approving an owner writes the log
 * separately from the status change, any failure between the two leaves the
 * pair disagreeing — a log entry saying "approved" beside an owner who is still
 * pending, or a silent approval with no record. Inside one transaction the two
 * commit together or not at all.
 *
 * `metadata` is JSON text rather than a native JSON column, for the same
 * SQLite/PostgreSQL portability reason as `Listing.amenities`.
 */

export type AuditActor = {
  id?: string | null;
  email?: string | null;
  role?: string | null;
};

export type AuditEntry = {
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** A short human-readable line, e.g. the owner's name. Never secrets. */
  summary?: string;
  metadata?: Record<string, unknown>;
};

/** Build the `data` payload for an audit row. */
export function auditData(entry: AuditEntry): Prisma.AuditLogCreateInput {
  return {
    // Connect by relation when we have an id, so a deleted actor nulls the
    // reference (onDelete: SetNull) while `actorEmail` preserves who it was.
    ...(entry.actor.id ? { actor: { connect: { id: entry.actor.id } } } : {}),
    actorEmail: entry.actor.email ?? "",
    actorRole: entry.actor.role ?? "",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary ?? "",
    metadata: safeStringify(entry.metadata ?? {}),
  };
}

/**
 * Serialise metadata, never throwing.
 *
 * A circular reference or a BigInt in a metadata object must not be able to
 * abort the transaction it is attached to — losing an owner approval because
 * its log entry could not be stringified would be an absurd failure mode. An
 * unserialisable payload degrades to a marker object instead.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  } catch {
    return '{"_error":"unserialisable"}';
  }
}

/** Parse a stored metadata blob back into an object. Corrupt values yield {}. */
export function parseAuditMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

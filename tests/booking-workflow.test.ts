import { describe, expect, it } from "vitest";
import {
  BOOKING_STAGES,
  BOOKING_STATUSES,
  isBookingStage,
  isReviewStatus,
  isStageComplete,
  nextStage,
  REVIEW_STATUSES,
  stageNumber,
  WORKFLOW_STAGES,
} from "@/lib/constants";
import { platformCommission } from "@/lib/pricing";

/**
 * The booking handover workflow.
 *
 * These cover the pure logic the stepper and its server action both read: the
 * ordering that decides which step is current, and the commission arithmetic.
 * The database transitions themselves are exercised against a real PostgreSQL
 * instance rather than mocked here.
 */

describe("the stage sequence", () => {
  it("runs the seven steps in the order the owner works them", () => {
    expect([...BOOKING_STAGES]).toEqual([
      "DEPOSIT",
      "BALANCE",
      "CHECKOUT",
      "INSPECTION",
      "SECURITY",
      "COMMISSION",
      "REVIEW",
      "DONE",
    ]);
  });

  it("keeps DONE out of the steps the interface draws", () => {
    // DONE is a terminus, not a step: it has no action, no amount and nothing
    // for the owner to do. A stepper that rendered it would show eight steps.
    expect(WORKFLOW_STAGES).toHaveLength(7);
    expect(WORKFLOW_STAGES).not.toContain("DONE");
  });

  it("stays orthogonal to the booking status", () => {
    // `status` closes the calendar; `stage` tracks the handover. If a stage
    // name ever collided with a status name, a filter reading one column would
    // silently match rows from the other.
    for (const stage of BOOKING_STAGES) {
      expect(BOOKING_STATUSES as readonly string[]).not.toContain(stage);
    }
  });

  it("numbers steps from 1", () => {
    expect(stageNumber("DEPOSIT")).toBe(1);
    expect(stageNumber("REVIEW")).toBe(7);
  });

  it("reports 0 for a stage this build does not know", () => {
    // A row written by a newer deployment must degrade to "no step" rather
    // than rendering a negative number beside a real booking.
    expect(stageNumber("SOMETHING_ELSE")).toBe(0);
  });

  it("treats only strictly earlier steps as complete", () => {
    // The step you are ON is not done — that is the one with the button.
    expect(isStageComplete("CHECKOUT", "DEPOSIT")).toBe(true);
    expect(isStageComplete("CHECKOUT", "BALANCE")).toBe(true);
    expect(isStageComplete("CHECKOUT", "CHECKOUT")).toBe(false);
    expect(isStageComplete("CHECKOUT", "SECURITY")).toBe(false);
  });

  it("counts every step as complete once the booking is DONE", () => {
    for (const step of WORKFLOW_STAGES) {
      expect(isStageComplete("DONE", step)).toBe(true);
    }
  });

  it("advances one step at a time and stops at DONE", () => {
    expect(nextStage("DEPOSIT")).toBe("BALANCE");
    expect(nextStage("REVIEW")).toBe("DONE");
    // Its own successor — the sequence ends rather than running off the array.
    expect(nextStage("DONE")).toBe("DONE");
  });

  it("guards against a stage arriving from a form", () => {
    expect(isBookingStage("SECURITY")).toBe(true);
    expect(isBookingStage("security")).toBe(false);
    expect(isBookingStage("")).toBe(false);
    expect(isBookingStage(null)).toBe(false);
    expect(isBookingStage(5)).toBe(false);
  });
});

describe("review moderation states", () => {
  it("has exactly the three the queue filters on", () => {
    expect([...REVIEW_STATUSES]).toEqual(["PENDING", "APPROVED", "REJECTED"]);
  });

  it("guards against a status arriving from a query string", () => {
    expect(isReviewStatus("PENDING")).toBe(true);
    expect(isReviewStatus("pending")).toBe(false);
    expect(isReviewStatus(undefined)).toBe(false);
  });
});

describe("the platform commission", () => {
  it("is a percentage of the booking value", () => {
    expect(platformCommission(2000, 5)).toEqual({ percent: 5, due: 100 });
  });

  it("rounds to whole dirhams the same way the service fee does", () => {
    // 1,050 × 5% = 52.5. Both figures on a receipt have to round identically
    // or they land a dirham apart from the same total.
    expect(platformCommission(1050, 5).due).toBe(53);
  });

  it("charges nothing at 0%", () => {
    // A distinct, meaningful setting — an operator running a listing at no
    // commission, not an unset value.
    expect(platformCommission(5000, 0).due).toBe(0);
  });

  it("clamps a percentage that somehow escaped validation", () => {
    // A direct database edit or an old row must not be able to produce a
    // commission larger than the booking, or a negative one.
    expect(platformCommission(1000, 250).due).toBe(1000);
    expect(platformCommission(1000, -10).due).toBe(0);
  });

  it("never returns a negative amount for a nonsense total", () => {
    expect(platformCommission(-500, 5).due).toBe(0);
  });

  it("is not the same number as a guest-facing service fee", () => {
    // The service fee is added ON TOP of the nights and paid by the guest; the
    // commission is taken OUT of the owner's revenue. With the fee at 0 the
    // commission still has to be charged, which is the whole reason the two
    // are separate columns.
    const total = 3000; // subtotal + 0% service fee
    expect(platformCommission(total, 5).due).toBe(150);
  });
});

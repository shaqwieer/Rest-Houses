import { mintChallenge, solveChallenge } from "@/lib/security";

/**
 * The evidence a real browser attaches to a public form submission.
 *
 * The suite drives the server actions directly, so it has to produce what the
 * widget would: a signed challenge and a valid proof of work. That is on
 * purpose — the alternative, an `NODE_ENV === "test"` bypass inside the guard,
 * would leave the one code path protecting these two forms completely untested,
 * and every test here would keep passing if the gate were deleted.
 *
 * The challenge is minted five seconds in the past. The server refuses anything
 * that arrives less than two seconds after minting (no human fills a booking
 * form that fast), and backdating clears that floor without every test in the
 * file sleeping through it.
 */
export function humanCheckFields(
  purpose: "booking" | "owner-register",
): Record<string, string> {
  const { token } = mintChallenge(purpose, Date.now() - 5_000);
  return {
    securityToken: token,
    humanProof: solveChallenge(token),
    // The honeypot, submitted the way a person leaves it: empty.
    websiteUrl: "",
  };
}

-- ---------------------------------------------------------------------------
-- Payment provider architecture.
--
-- Purely ADDITIVE: three new tables, and new columns on three existing ones —
-- every one of them either nullable or carrying a default that means "exactly
-- what this row meant before". Nothing is renamed, nothing is dropped and there
-- is no data to backfill, so replaying this against production changes the
-- behaviour of not one existing booking.
--
-- Read that claim column by column, because it is the whole safety argument:
--
--   BookingRequest.paymentMode  DEFAULT 'MANUAL' — which is what every booking
--       that predates this genuinely was: the flow saved a request and handed
--       the guest to WhatsApp, where the owner collected the deposit. No
--       existing row changes meaning.
--   SiteSettings.telrEnabled / tabbyEnabled / tamaraEnabled / paymentLinksEnabled
--       DEFAULT false — an install that has connected no gateway must advertise
--       none. A defaulted-true flag here would put a checkout button in front of
--       guests the moment this migration lands.
--   SiteSettings.paymentLinkDays DEFAULT 7 — read only when a link is issued,
--       which nothing does until payment links are switched on.
--   Listing.paymentModes NULL — "inherit the platform's list", which is the
--       behaviour every listing has today. Deliberately not defaulted to a JSON
--       array: NULL and '[]' are different answers (see the column's note in
--       schema.prisma) and defaulting would have destroyed the distinction on
--       every existing row.
--
-- `paymentStatus` and `paymentReference` on BookingRequest are untouched. They
-- keep their existing vocabulary and become the roll-up over the new Payment
-- ledger.
-- ---------------------------------------------------------------------------

-- --- BookingRequest --------------------------------------------------------
ALTER TABLE "BookingRequest" ADD COLUMN "paymentMode" TEXT NOT NULL DEFAULT 'MANUAL';

-- --- SiteSettings ----------------------------------------------------------
ALTER TABLE "SiteSettings" ADD COLUMN "telrEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteSettings" ADD COLUMN "tabbyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteSettings" ADD COLUMN "tamaraEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteSettings" ADD COLUMN "paymentLinksEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SiteSettings" ADD COLUMN "paymentLinkDays" INTEGER NOT NULL DEFAULT 7;

-- --- Listing ---------------------------------------------------------------
ALTER TABLE "Listing" ADD COLUMN "paymentModes" TEXT;

-- --- Payment ---------------------------------------------------------------
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DEPOSIT',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "providerStatus" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- The idempotency guarantee for callbacks, expressed where concurrent webhook
-- retries cannot race it. `providerRef` is NULL until a provider issues one and
-- PostgreSQL treats NULLs as distinct, so any number of not-yet-initiated
-- attempts coexist under this index while two rows can never claim one real
-- reference.
CREATE UNIQUE INDEX "Payment_provider_providerRef_key" ON "Payment"("provider", "providerRef");
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_provider_createdAt_idx" ON "Payment"("provider", "createdAt");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "BookingRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- --- PaymentEvent ----------------------------------------------------------
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerStatus" TEXT,
    "status" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- The second delivery of the same webhook fails on THIS index rather than being
-- filtered out by an application-level "have I seen it?" read, which two
-- concurrent retries would both answer "no" to.
CREATE UNIQUE INDEX "PaymentEvent_provider_eventId_key" ON "PaymentEvent"("provider", "eventId");
CREATE INDEX "PaymentEvent_paymentId_idx" ON "PaymentEvent"("paymentId");
CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");

ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- --- PaymentLink -----------------------------------------------------------
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "kind" TEXT NOT NULL DEFAULT 'DEPOSIT',
    "paymentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentLink_token_key" ON "PaymentLink"("token");
CREATE INDEX "PaymentLink_bookingId_idx" ON "PaymentLink"("bookingId");
CREATE INDEX "PaymentLink_expiresAt_idx" ON "PaymentLink"("expiresAt");

ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "BookingRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Deleting a staff account must not cascade away the payment history of a
-- booking, so the issuer is nulled rather than the link removed.
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_issuedById_fkey"
    FOREIGN KEY ("issuedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

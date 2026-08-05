-- ---------------------------------------------------------------------------
-- An owner signs in with their phone number.
--
-- Three steps, in this order, and the order is what makes it safe:
--   1. add the nullable column
--   2. normalise every OwnerProfile.phone that is already stored
--   3. backfill User.username from those numbers, but ONLY where the result is
--      unique — then add the unique index
--
-- Step 3 is the one that can fail a deploy. This database has no `db push`
-- fallback (see the header of schema.prisma): a migration that raises stops the
-- release. Creating a unique index over backfilled data raises if two owners
-- normalise to the same number — which is entirely possible, because until now
-- nothing stopped two accounts sharing a mobile. So the backfill excludes any
-- colliding number and leaves those rows NULL, which PostgreSQL permits any
-- number of under a unique index.
--
-- An owner left NULL here CANNOT SIGN IN: an email address authenticates
-- operators only. That is the deliberate trade — a migration that skips two
-- rows for an operator to fix is recoverable, a migration that aborts takes the
-- whole release down. Check for them after deploying:
--
--   SELECT u.email, p.phone FROM "User" u
--   JOIN "OwnerProfile" p ON p."userId" = u.id
--   WHERE u.role = 'OWNER' AND u.username IS NULL;
--
-- Each one is fixed by setting a distinct phone number on /admin/owners, which
-- writes the username in the same transaction.
-- ---------------------------------------------------------------------------

ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- ---------------------------------------------------------------------------
-- Step 2 — normalise the stored numbers.
--
-- This is `normalizePhone()` from src/lib/phone.ts, transcribed. The branches
-- and their order are the same, because the two have to agree exactly: this
-- decides what an existing owner's username becomes, and the TypeScript decides
-- what they type at the login form. If they disagree, the login silently fails
-- for every owner who registered before today.
--
-- Rows whose number cannot be salvaged (empty, or Arabic-Indic digits that the
-- ASCII-only [^0-9] filter strips to nothing) are left exactly as they are: the
-- length guard at the end skips them rather than overwriting a bad value with a
-- worse one.
-- ---------------------------------------------------------------------------
WITH normalized AS (
  SELECT
    id,
    CASE
      WHEN digits = ''                                        THEN digits
      -- "00" is the ITU international access prefix — same as a leading "+".
      WHEN digits LIKE '00%'                                  THEN substring(digits FROM 3)
      -- Already written internationally; nothing to add.
      WHEN raw LIKE '+%'                                      THEN digits
      -- National trunk prefix: drop the 0, prepend the country code.
      WHEN digits LIKE '0%'                                   THEN '971' || substring(digits FROM 2)
      -- A bare national number. The UAE is assumed only for the two lengths a
      -- national significant number actually has — 9 for a mobile, 8 for a
      -- landline. Anything else is left alone: it may already carry a foreign
      -- country code, and shorter input is nonsense that must not be padded
      -- into a valid-looking number.
      WHEN digits NOT LIKE '971%' AND length(digits) IN (8, 9) THEN '971' || digits
      ELSE digits
    END AS phone_normalized
  FROM (
    SELECT id, phone AS raw, regexp_replace(phone, '[^0-9]', '', 'g') AS digits
    FROM "OwnerProfile"
  ) s
)
UPDATE "OwnerProfile" p
SET phone = n.phone_normalized
FROM normalized n
WHERE p.id = n.id
  AND length(n.phone_normalized) BETWEEN 8 AND 15;

-- The WhatsApp column has been stored normalised all along, but only by the
-- application — a row written before that helper existed, or edited directly,
-- can still be in any shape. Same treatment, same guard.
WITH normalized AS (
  SELECT
    id,
    CASE
      WHEN digits = ''                                        THEN digits
      WHEN digits LIKE '00%'                                  THEN substring(digits FROM 3)
      WHEN raw LIKE '+%'                                      THEN digits
      WHEN digits LIKE '0%'                                   THEN '971' || substring(digits FROM 2)
      WHEN digits NOT LIKE '971%' AND length(digits) IN (8, 9) THEN '971' || digits
      ELSE digits
    END AS whatsapp_normalized
  FROM (
    SELECT id, whatsapp AS raw, regexp_replace(whatsapp, '[^0-9]', '', 'g') AS digits
    FROM "OwnerProfile"
  ) s
)
UPDATE "OwnerProfile" p
SET whatsapp = n.whatsapp_normalized
FROM normalized n
WHERE p.id = n.id
  AND length(n.whatsapp_normalized) BETWEEN 8 AND 15;

-- ---------------------------------------------------------------------------
-- Step 3 — backfill the username, skipping collisions.
--
-- `HAVING count(*) = 1` is the whole safety mechanism: a number held by two
-- owners produces no row here, so neither of them gets a username and the
-- unique index below has nothing to choke on.
-- ---------------------------------------------------------------------------
WITH unique_phone AS (
  SELECT phone, min("userId") AS user_id
  FROM "OwnerProfile"
  WHERE phone ~ '^[0-9]{8,15}$'
  GROUP BY phone
  HAVING count(*) = 1
)
UPDATE "User" u
SET username = up.phone
FROM unique_phone up
WHERE u.id = up.user_id;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

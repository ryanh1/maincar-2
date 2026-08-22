-- AlterTable
ALTER TABLE "Org" ADD COLUMN     "recordingBlockedStates" TEXT[] DEFAULT ARRAY['CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NV', 'NH', 'OR', 'PA', 'WA', 'UNKNOWN']::TEXT[];

-- Preserve the policy each organization had before MAI-315. A non-empty
-- allowlist becomes its complement, while the legacy two-party flag controls
-- the preset plus the conservative Unknown entry.
UPDATE "Org"
SET "recordingBlockedStates" = (
  SELECT COALESCE(array_agg(state ORDER BY state), ARRAY[]::TEXT[])
  FROM (
    SELECT state
    FROM unnest(ARRAY['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC']::TEXT[]) AS state
    WHERE cardinality("recordingAllowedStates") > 0
      AND NOT state = ANY("recordingAllowedStates")
    UNION
    SELECT state
    FROM unnest(CASE WHEN "blockTwoPartyConsentStates"
      THEN ARRAY['CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NV', 'NH', 'OR', 'PA', 'WA', 'UNKNOWN']::TEXT[]
      ELSE ARRAY[]::TEXT[]
    END) AS state
  ) AS blocked_state
);

ALTER TABLE "Org" ALTER COLUMN "recordingBlockedStates" SET NOT NULL;

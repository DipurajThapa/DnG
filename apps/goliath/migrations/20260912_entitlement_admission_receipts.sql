-- Signed David -> Goliath entitlement receipt and organisation-admission history.
-- The signature is verified by the server-side identity-contracts package before insert.
-- These records never create organisation membership, project membership, team membership,
-- responsibility assignments, roles or permissions.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_identity.entitlement_receipts (
  grant_id text PRIMARY KEY,
  issuer text NOT NULL,
  audience text NOT NULL,
  key_id text NOT NULL,
  source_organisation_id text NOT NULL,
  goliath_organisation_id text REFERENCES public.ec_organisations(id),
  customer_account_id text NOT NULL,
  plan_code text NOT NULL,
  project_limit integer NOT NULL CHECK (project_limit BETWEEN 0 AND 100000),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('active','grace','restricted','revoked')),
  entitlement_revision integer NOT NULL CHECK (entitlement_revision > 0),
  issued_at timestamptz NOT NULL,
  not_before timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  nonce text NOT NULL UNIQUE,
  envelope_sha256 text NOT NULL UNIQUE CHECK (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now(),
  verified_by text NOT NULL,
  CHECK (not_before >= issued_at),
  CHECK (expires_at > not_before)
);

CREATE INDEX IF NOT EXISTS idx_entitlement_receipts_source_org
  ON platform_identity.entitlement_receipts(source_organisation_id,entitlement_revision DESC);
CREATE INDEX IF NOT EXISTS idx_entitlement_receipts_goliath_org
  ON platform_identity.entitlement_receipts(goliath_organisation_id,entitlement_revision DESC);

CREATE TABLE IF NOT EXISTS platform_identity.organisation_admission_events (
  event_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_organisation_id text NOT NULL,
  goliath_organisation_id text NOT NULL REFERENCES public.ec_organisations(id),
  entitlement_grant_id text NOT NULL REFERENCES platform_identity.entitlement_receipts(grant_id),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('active','grace','restricted','revoked')),
  access_mode text NOT NULL CHECK (access_mode IN ('enabled','grace','restricted','denied')),
  project_limit integer NOT NULL CHECK (project_limit BETWEEN 0 AND 100000),
  project_provisioning_allowed boolean NOT NULL,
  effective_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL,
  reason text NOT NULL,
  CHECK (
    (lifecycle_state='active' AND access_mode='enabled' AND project_provisioning_allowed)
    OR (lifecycle_state='grace' AND access_mode='grace' AND NOT project_provisioning_allowed)
    OR (lifecycle_state='restricted' AND access_mode='restricted' AND NOT project_provisioning_allowed)
    OR (lifecycle_state='revoked' AND access_mode='denied' AND NOT project_provisioning_allowed)
  )
);

CREATE INDEX IF NOT EXISTS idx_organisation_admission_events_current
  ON platform_identity.organisation_admission_events(source_organisation_id,effective_at DESC,recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_organisation_admission_events_goliath_org
  ON platform_identity.organisation_admission_events(goliath_organisation_id,effective_at DESC,recorded_at DESC);

CREATE OR REPLACE VIEW platform_identity.current_organisation_admissions AS
SELECT DISTINCT ON (e.source_organisation_id)
  e.source_organisation_id,
  e.goliath_organisation_id,
  e.entitlement_grant_id,
  e.lifecycle_state,
  e.access_mode,
  e.project_limit,
  e.project_provisioning_allowed,
  e.effective_at,
  e.recorded_at,
  e.reason
FROM platform_identity.organisation_admission_events e
WHERE e.effective_at<=now()
ORDER BY e.source_organisation_id,e.effective_at DESC,e.recorded_at DESC,e.event_id DESC;

CREATE OR REPLACE FUNCTION platform_identity.reject_admission_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Entitlement receipts and admission events are append-only.' USING ERRCODE='55000';
END
$function$;

DROP TRIGGER IF EXISTS trg_entitlement_receipts_immutable ON platform_identity.entitlement_receipts;
CREATE TRIGGER trg_entitlement_receipts_immutable
BEFORE UPDATE OR DELETE ON platform_identity.entitlement_receipts
FOR EACH ROW EXECUTE FUNCTION platform_identity.reject_admission_history_mutation();

DROP TRIGGER IF EXISTS trg_organisation_admission_events_immutable ON platform_identity.organisation_admission_events;
CREATE TRIGGER trg_organisation_admission_events_immutable
BEFORE UPDATE OR DELETE ON platform_identity.organisation_admission_events
FOR EACH ROW EXECUTE FUNCTION platform_identity.reject_admission_history_mutation();

COMMENT ON TABLE platform_identity.entitlement_receipts IS
  'Server-verified, replay-protected David entitlement receipts. Does not grant user or project authority.';
COMMENT ON TABLE platform_identity.organisation_admission_events IS
  'Append-only organisation commercial-admission lifecycle. Project and individual access remain separate.';
COMMENT ON VIEW platform_identity.current_organisation_admissions IS
  'Latest commercial admission state per source organisation; never a project authorization context.';

REVOKE ALL ON TABLE platform_identity.entitlement_receipts FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON TABLE platform_identity.organisation_admission_events FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON TABLE platform_identity.current_organisation_admissions FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION platform_identity.reject_admission_history_mutation() FROM PUBLIC,authenticated,anonymous,goliath_web_anon;

COMMIT;

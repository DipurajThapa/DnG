-- Close remaining post-identity mutation paths that were not yet represented in the canonical action policy.

INSERT INTO platform_identity.action_catalog(object_type,action,display_name,data_class,consequence,data_action) VALUES
('identity','share-invitation','Share pending identity invitation','audit','administrative','read'),
('integration','reconcile-exception','Register/respond reconciliation exception','delivery','normal','write'),
('outcome','admin-effort-sample','Record administrative-effort outcome sample','delivery','normal','write')
ON CONFLICT (object_type,action) DO UPDATE SET display_name=EXCLUDED.display_name,data_class=EXCLUDED.data_class,consequence=EXCLUDED.consequence,data_action=EXCLUDED.data_action,active=1;

INSERT INTO platform_identity.role_action_policy(role_key,object_type,action,authority_mode,notes)
SELECT r.role_key,a.object_type,a.action,'deny','Default deny; explicitly overridden below.'
FROM platform_identity.role_catalog r CROSS JOIN platform_identity.action_catalog a
WHERE r.active=1 AND a.active=1
ON CONFLICT (role_key,object_type,action) DO NOTHING;

UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Enterprise Admin may share an existing pending invitation without minting another token.'
WHERE role_key='enterprise-admin' AND object_type='identity' AND action='share-invitation';
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='PMO owns reconciliation ambiguity registration and resolution.'
WHERE role_key='pmo' AND object_type='integration' AND action='reconcile-exception';
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Management may record observed administrative-effort outcome samples.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo') AND object_type='outcome' AND action='admin-effort-sample';

-- Invitation sharing already has a dedicated implementation; add capability gate directly.
DO $$ BEGIN
  IF to_regprocedure('goliath_api._policy_admin_record_identity_invitation_share(text,uuid,text)') IS NULL THEN
    ALTER FUNCTION goliath_api.admin_record_identity_invitation_share(text,uuid,text) RENAME TO _policy_admin_record_identity_invitation_share;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regprocedure('goliath_api._policy_create_reconciliation_issue(text,text,text,text,text,text,text,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION goliath_api.create_reconciliation_issue(text,text,text,text,text,text,text,jsonb,jsonb) RENAME TO _policy_create_reconciliation_issue;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regprocedure('goliath_api._policy_respond_reconciliation_issue(text,text,text,text)') IS NULL THEN
    ALTER FUNCTION goliath_api.respond_reconciliation_issue(text,text,text,text) RENAME TO _policy_respond_reconciliation_issue;
  END IF;
END $$;
DO $$ BEGIN
  IF to_regprocedure('goliath_api._policy_record_admin_effort_sample(text,text,text,text,real,real,real,real,real,real)') IS NULL THEN
    ALTER FUNCTION goliath_api.record_admin_effort_sample(text,text,text,text,real,real,real,real,real,real) RENAME TO _policy_record_admin_effort_sample;
  END IF;
END $$;

REVOKE ALL ON FUNCTION goliath_api._policy_admin_record_identity_invitation_share(text,uuid,text) FROM PUBLIC, authenticated, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._policy_create_reconciliation_issue(text,text,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC, authenticated, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._policy_respond_reconciliation_issue(text,text,text,text) FROM PUBLIC, authenticated, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._policy_record_admin_effort_sample(text,text,text,text,real,real,real,real,real,real) FROM PUBLIC, authenticated, goliath_web_anon;

CREATE OR REPLACE FUNCTION goliath_api.admin_record_identity_invitation_share(p_acting_assignment_id text,p_token uuid,p_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$ BEGIN PERFORM goliath_api.require_capability(p_acting_assignment_id,'identity','share-invitation'); RETURN goliath_api._policy_admin_record_identity_invitation_share(p_acting_assignment_id,p_token,p_channel); END $function$;
CREATE OR REPLACE FUNCTION goliath_api.create_reconciliation_issue(p_assignment_id text,p_project_id text,p_binding_id text,p_inbox_id text,p_issue_type text,p_severity text,p_summary text,p_details jsonb DEFAULT '{}'::jsonb,p_candidate_matches jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$ BEGIN PERFORM goliath_api.require_capability(p_assignment_id,'integration','reconcile-exception'); RETURN goliath_api._policy_create_reconciliation_issue(p_assignment_id,p_project_id,p_binding_id,p_inbox_id,p_issue_type,p_severity,p_summary,p_details,p_candidate_matches); END $function$;
CREATE OR REPLACE FUNCTION goliath_api.respond_reconciliation_issue(p_assignment_id text,p_issue_id text,p_action text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$ BEGIN PERFORM goliath_api.require_capability(p_assignment_id,'integration','reconcile-exception'); RETURN goliath_api._policy_respond_reconciliation_issue(p_assignment_id,p_issue_id,p_action,p_reason); END $function$;
CREATE OR REPLACE FUNCTION goliath_api.record_admin_effort_sample(p_assignment_id text,p_project_id text,p_period text,p_sample_type text,p_status_collection_minutes real,p_reconciliation_minutes real,p_chasing_minutes real,p_reporting_minutes real,p_duplicate_governance_minutes real,p_decision_preparation_minutes real)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$ BEGIN PERFORM goliath_api.require_capability(p_assignment_id,'outcome','admin-effort-sample'); RETURN goliath_api._policy_record_admin_effort_sample(p_assignment_id,p_project_id,p_period,p_sample_type,p_status_collection_minutes,p_reconciliation_minutes,p_chasing_minutes,p_reporting_minutes,p_duplicate_governance_minutes,p_decision_preparation_minutes); END $function$;

GRANT EXECUTE ON FUNCTION goliath_api.admin_record_identity_invitation_share(text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.create_reconciliation_issue(text,text,text,text,text,text,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.respond_reconciliation_issue(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.record_admin_effort_sample(text,text,text,text,real,real,real,real,real,real) TO authenticated;

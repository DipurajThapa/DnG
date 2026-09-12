-- Goliath governance authorization hardening
-- Date: 2026-09-12
-- Purpose: ensure newer governance/report/control functions consistently enforce
-- identity -> responsibility -> project scope -> data class before delegating to
-- the previously validated implementation.

BEGIN;

ALTER FUNCTION goliath_api.requirements_view(text,text) RENAME TO _requirements_view_internal;
ALTER FUNCTION goliath_api.baseline_status(text,text) RENAME TO _baseline_status_internal;
ALTER FUNCTION goliath_api.project_control_extensions(text,text) RENAME TO _project_control_extensions_internal;
ALTER FUNCTION goliath_api.baseline_requirement(text,text,text) RENAME TO _baseline_requirement_internal;
ALTER FUNCTION goliath_api.accept_requirement(text,text,jsonb,text) RENAME TO _accept_requirement_internal;
ALTER FUNCTION goliath_api.evaluate_raid_triggers(text,text) RENAME TO _evaluate_raid_triggers_internal;
ALTER FUNCTION goliath_api.convert_raid_trigger_to_issue(text,text,text,text,text) RENAME TO _convert_raid_trigger_to_issue_internal;
ALTER FUNCTION goliath_api.submit_initial_baseline(text,text,text,text) RENAME TO _submit_initial_baseline_internal;
ALTER FUNCTION goliath_api.finalize_initial_baseline(text,text,text) RENAME TO _finalize_initial_baseline_internal;
ALTER FUNCTION goliath_api.finalize_change_request(text,text,text) RENAME TO _finalize_change_request_internal;
ALTER FUNCTION goliath_api.snapshot_project_report(text,text,text,text,text,text,text) RENAME TO _snapshot_project_report_internal;
ALTER FUNCTION goliath_api.respond_notification(text,text,text,text,text) RENAME TO _respond_notification_internal;

CREATE OR REPLACE FUNCTION goliath_api.requirements_view(p_assignment_id text,p_project_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._requirements_view_internal(p_assignment_id,p_project_id);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.baseline_status(p_assignment_id text,p_project_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._baseline_status_internal(p_assignment_id,p_project_id);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.project_control_extensions(p_assignment_id text,p_project_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._project_control_extensions_internal(p_assignment_id,p_project_id);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.baseline_requirement(p_assignment_id text,p_requirement_id text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._baseline_requirement_internal(p_assignment_id,p_requirement_id,p_reason);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.accept_requirement(p_assignment_id text,p_requirement_id text,p_evidence_refs jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._accept_requirement_internal(p_assignment_id,p_requirement_id,p_evidence_refs,p_reason);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.evaluate_raid_triggers(p_assignment_id text,p_project_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._evaluate_raid_triggers_internal(p_assignment_id,p_project_id);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.convert_raid_trigger_to_issue(p_assignment_id text,p_trigger_event_id text,p_owner_id text,p_description text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._convert_raid_trigger_to_issue_internal(p_assignment_id,p_trigger_event_id,p_owner_id,p_description,p_reason);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.submit_initial_baseline(p_assignment_id text,p_project_id text,p_approver_user_id text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._submit_initial_baseline_internal(p_assignment_id,p_project_id,p_approver_user_id,p_reason);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.finalize_initial_baseline(p_assignment_id text,p_project_id text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._finalize_initial_baseline_internal(p_assignment_id,p_project_id,p_reason);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.finalize_change_request(p_assignment_id text,p_change_request_id text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._finalize_change_request_internal(p_assignment_id,p_change_request_id,p_reason);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.snapshot_project_report(
  p_assignment_id text,p_project_id text,p_audience text,p_period_kind text DEFAULT 'weekly',
  p_period_start text DEFAULT NULL,p_period_end text DEFAULT NULL,p_external_approval_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority required.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._snapshot_project_report_internal(p_assignment_id,p_project_id,p_audience,p_period_kind,p_period_start,p_period_end,p_external_approval_reason);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.respond_notification(
  p_assignment_id text,p_notification_id text,p_action text,p_reason text DEFAULT NULL,p_snooze_until text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$ DECLARE v_class text; BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  SELECT data_class INTO v_class FROM public.pc_notifications WHERE id=p_notification_id;
  IF v_class IS NULL OR NOT goliath_api.context_has_data_class(p_assignment_id,v_class,'read') THEN RAISE EXCEPTION 'Notification data class is not available to this responsibility.' USING ERRCODE='42501'; END IF;
  RETURN goliath_api._respond_notification_internal(p_assignment_id,p_notification_id,p_action,p_reason,p_snooze_until);
END $$;

-- Internal implementations are callable only by the owning security-definer wrappers.
REVOKE ALL ON FUNCTION goliath_api._requirements_view_internal(text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._baseline_status_internal(text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._project_control_extensions_internal(text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._baseline_requirement_internal(text,text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._accept_requirement_internal(text,text,jsonb,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._evaluate_raid_triggers_internal(text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._convert_raid_trigger_to_issue_internal(text,text,text,text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._submit_initial_baseline_internal(text,text,text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._finalize_initial_baseline_internal(text,text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._finalize_change_request_internal(text,text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._snapshot_project_report_internal(text,text,text,text,text,text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api._respond_notification_internal(text,text,text,text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;

REVOKE ALL ON FUNCTION goliath_api.requirements_view(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.baseline_status(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.project_control_extensions(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.baseline_requirement(text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.accept_requirement(text,text,jsonb,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.evaluate_raid_triggers(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.convert_raid_trigger_to_issue(text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.submit_initial_baseline(text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.finalize_initial_baseline(text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.finalize_change_request(text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.snapshot_project_report(text,text,text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.respond_notification(text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;

GRANT EXECUTE ON FUNCTION goliath_api.requirements_view(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.baseline_status(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.project_control_extensions(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.baseline_requirement(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.accept_requirement(text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.evaluate_raid_triggers(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.convert_raid_trigger_to_issue(text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.submit_initial_baseline(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.finalize_initial_baseline(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.finalize_change_request(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.snapshot_project_report(text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.respond_notification(text,text,text,text,text) TO authenticated;

COMMIT;

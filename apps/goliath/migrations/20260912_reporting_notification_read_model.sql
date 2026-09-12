-- Goliath reporting + notification read model update
-- Date: 2026-09-12
-- Purpose: expose new control surfaces through server-resolved navigation and home projection.

BEGIN;

CREATE OR REPLACE FUNCTION goliath_api.mvp_navigation(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_role text; v_surfaces jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_role:=c->>'role';
  v_surfaces:=CASE v_role
    WHEN 'enterprise-admin' THEN '["administration"]'::jsonb
    WHEN 'resource-manager' THEN '["capacity"]'::jsonb
    WHEN 'sponsor' THEN '["decisions","overview","reports"]'::jsonb
    WHEN 'portfolio-manager' THEN '["attention","projects"]'::jsonb
    WHEN 'program-manager' THEN '["attention","projects","decisions","dependencies","reports"]'::jsonb
    WHEN 'project-director' THEN '["attention","overview","commitments","decisions","dependencies","reports"]'::jsonb
    WHEN 'project-manager' THEN '["attention","overview","commitments","decisions","dependencies","reports"]'::jsonb
    WHEN 'pmo' THEN '["controls","projects","decisions","dependencies","reports"]'::jsonb
    WHEN 'delivery-lead' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    WHEN 'agile-delivery-lead' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    WHEN 'team-member' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    ELSE '[]'::jsonb END;
  RETURN jsonb_build_object(
    'assignmentId',c->>'assignmentId','role',v_role,'scopeType',c->>'scopeType','scopeId',c->>'scopeId','teamId',c->>'teamId',
    'surfaces',v_surfaces,'defaultSurface',CASE WHEN jsonb_array_length(v_surfaces)>0 THEN v_surfaces->>0 ELSE NULL END
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.control_home(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; nav jsonb; v_role text; projects jsonb; mine jsonb; decisions jsonb; deps jsonb; debt jsonb; notes jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_role:=c->>'role';
  nav:=goliath_api.mvp_navigation(p_assignment_id);
  projects:=CASE WHEN v_role IN ('enterprise-admin','resource-manager') THEN '[]'::jsonb ELSE goliath_api.scoped_project_list(p_assignment_id) END;
  mine:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','sponsor','portfolio-manager') THEN '[]'::jsonb ELSE goliath_api.my_commitments(p_assignment_id) END;
  decisions:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','portfolio-manager') THEN '[]'::jsonb ELSE goliath_api.decision_queue(p_assignment_id) END;
  deps:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','portfolio-manager','sponsor') THEN '[]'::jsonb ELSE goliath_api.dependency_queue(p_assignment_id) END;
  debt:=CASE WHEN v_role IN ('enterprise-admin','resource-manager') THEN NULL ELSE goliath_api.decision_debt_summary(p_assignment_id) END;
  notes:=CASE WHEN v_role='enterprise-admin' THEN '[]'::jsonb ELSE goliath_api.notification_queue(p_assignment_id) END;
  RETURN jsonb_build_object(
    'identity',jsonb_build_object('userId',c->>'userId','displayName',c->>'displayName','role',v_role,'scopeType',c->>'scopeType','scopeId',c->>'scopeId','teamId',c->>'teamId'),
    'navigation',nav,'projects',projects,'myCommitments',mine,'decisions',decisions,'dependencies',deps,'decisionDebt',debt,'notifications',notes
  );
END
$$;

REVOKE ALL ON FUNCTION goliath_api.mvp_navigation(text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.control_home(text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.mvp_navigation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.control_home(text) TO authenticated;

COMMIT;

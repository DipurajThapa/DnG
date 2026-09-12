-- Real-session, non-mutating authorization contract self-test.
-- Records only policy evaluation evidence; it does not impersonate roles or execute business writes.

CREATE TABLE IF NOT EXISTS platform_identity.authorization_self_test_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  auth_subject text NOT NULL,
  user_id text NOT NULL,
  assignment_id text NOT NULL,
  role text NOT NULL,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  policy_hash text NOT NULL,
  passed integer NOT NULL CHECK (passed IN (0,1)),
  total_actions integer NOT NULL,
  mismatch_count integer NOT NULL,
  results_json text NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_self_test_assignment_time
  ON platform_identity.authorization_self_test_runs(assignment_id,run_at DESC);

REVOKE ALL ON platform_identity.authorization_self_test_runs FROM PUBLIC, authenticated, goliath_web_anon;

CREATE OR REPLACE FUNCTION goliath_api.run_authorization_self_test(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE
  c jsonb;
  v_subject text;
  v_caps jsonb;
  v_hash text;
  v_total integer;
  v_mismatch integer;
  v_results jsonb;
  v_passed integer;
  v_id text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_subject:=auth.user_id();
  IF v_subject IS NULL THEN RAISE EXCEPTION 'Authenticated identity required.' USING ERRCODE='42501'; END IF;

  v_caps:=goliath_api.my_capabilities(p_assignment_id);
  SELECT md5(string_agg(role_key||'|'||object_type||'|'||action||'|'||authority_mode||'|'||coalesce(condition_code,'')||'|'||active::text,';' ORDER BY object_type,action))
    INTO v_hash
  FROM platform_identity.role_action_policy
  WHERE role_key=c->>'role' AND active=1;

  SELECT count(*) INTO v_total
  FROM platform_identity.role_action_policy
  WHERE role_key=c->>'role' AND active=1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'objectType',p.object_type,'action',p.action,'policyMode',p.authority_mode,
      'dataClass',a.data_class,'dataAction',a.data_action,
      'hasDataAuthority',goliath_api.context_has_data_class(p_assignment_id,a.data_class,a.data_action),
      'effectiveMode',goliath_api.capability_mode(p_assignment_id,p.object_type,p.action),
      'consistent',CASE
        WHEN p.authority_mode='deny' THEN goliath_api.capability_mode(p_assignment_id,p.object_type,p.action)='deny'
        WHEN goliath_api.context_has_data_class(p_assignment_id,a.data_class,a.data_action) THEN goliath_api.capability_mode(p_assignment_id,p.object_type,p.action)=p.authority_mode
        ELSE goliath_api.capability_mode(p_assignment_id,p.object_type,p.action)='deny'
      END
    ) ORDER BY p.object_type,p.action),'[]'::jsonb),
    count(*) FILTER (WHERE NOT CASE
        WHEN p.authority_mode='deny' THEN goliath_api.capability_mode(p_assignment_id,p.object_type,p.action)='deny'
        WHEN goliath_api.context_has_data_class(p_assignment_id,a.data_class,a.data_action) THEN goliath_api.capability_mode(p_assignment_id,p.object_type,p.action)=p.authority_mode
        ELSE goliath_api.capability_mode(p_assignment_id,p.object_type,p.action)='deny'
      END)
    INTO v_results,v_mismatch
  FROM platform_identity.role_action_policy p
  JOIN platform_identity.action_catalog a ON a.object_type=p.object_type AND a.action=p.action
  WHERE p.role_key=c->>'role' AND p.active=1 AND a.active=1;

  v_passed:=CASE WHEN COALESCE(v_mismatch,0)=0 AND v_total>0 THEN 1 ELSE 0 END;
  INSERT INTO platform_identity.authorization_self_test_runs(
    auth_subject,user_id,assignment_id,role,scope_type,scope_id,policy_hash,passed,total_actions,mismatch_count,results_json)
  VALUES(v_subject,c->>'userId',p_assignment_id,c->>'role',c->>'scopeType',c->>'scopeId',v_hash,v_passed,v_total,COALESCE(v_mismatch,0),v_results::text)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'runId',v_id,'passed',v_passed=1,'role',c->>'role','assignmentId',p_assignment_id,
    'scopeType',c->>'scopeType','scopeId',c->>'scopeId','policyHash',v_hash,
    'totalActions',v_total,'mismatchCount',COALESCE(v_mismatch,0),'results',v_results
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.run_authorization_self_test(text) FROM PUBLIC, goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.run_authorization_self_test(text) TO authenticated;

CREATE OR REPLACE FUNCTION goliath_api.admin_authorization_acceptance_summary(p_acting_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE c jsonb;
BEGIN
  c:=goliath_api.require_context(p_acting_assignment_id);
  IF c->>'role'<>'enterprise-admin' OR NOT goliath_api.context_has_data_class(p_acting_assignment_id,'audit','read') THEN
    RAISE EXCEPTION 'Enterprise Admin audit-read authority is required.' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('runs',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',x.id,'userId',x.user_id,'assignmentId',x.assignment_id,'role',x.role,'scopeType',x.scope_type,'scopeId',x.scope_id,
      'passed',x.passed=1,'totalActions',x.total_actions,'mismatchCount',x.mismatch_count,'policyHash',x.policy_hash,'runAt',x.run_at
    ) ORDER BY x.run_at DESC)
    FROM (
      SELECT DISTINCT ON (assignment_id) *
      FROM platform_identity.authorization_self_test_runs
      ORDER BY assignment_id,run_at DESC
    ) x
  ),'[]'::jsonb));
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.admin_authorization_acceptance_summary(text) FROM PUBLIC, goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.admin_authorization_acceptance_summary(text) TO authenticated;

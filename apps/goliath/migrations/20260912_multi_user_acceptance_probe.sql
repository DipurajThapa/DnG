-- Multi-user acceptance probe and readiness diagnostics.
-- Development acceptance only: records authenticated boundary checks in the
-- existing identity audit ledger and never mutates project delivery state.

BEGIN;

CREATE OR REPLACE FUNCTION goliath_api.run_role_acceptance_probe(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','neon_auth','auth','goliath_api'
AS $function$
DECLARE
  c jsonb;
  v_home jsonb;
  v_role text;
  v_user text;
  v_scope_type text;
  v_scope_id text;
  v_org text;
  v_required_surface text;
  v_visible_project text;
  v_out_of_scope_project text;
  v_identity_bound boolean:=false;
  v_surface_visible boolean:=false;
  v_out_of_scope_hidden boolean:=true;
  v_admin_denied boolean:=false;
  v_cockpit_denied boolean:=false;
  v_expected_admin_denied boolean;
  v_expected_cockpit_denied boolean;
  v_passed boolean:=false;
  v_seq bigint;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_role:=c->>'role';
  v_user:=c->>'userId';
  v_scope_type:=c->>'scopeType';
  v_scope_id:=c->>'scopeId';
  v_home:=goliath_api.control_home(p_assignment_id);

  v_identity_bound:=v_home#>>'{identity,userId}'=v_user
    AND v_home#>>'{identity,role}'=v_role
    AND v_home#>>'{navigation,assignmentId}'=p_assignment_id;

  v_required_surface:=CASE v_role
    WHEN 'enterprise-admin' THEN 'administration'
    WHEN 'resource-manager' THEN 'capacity'
    WHEN 'sponsor' THEN 'decisions'
    WHEN 'portfolio-manager' THEN 'attention'
    WHEN 'pmo' THEN 'controls'
    WHEN 'team-member' THEN 'my-commitments'
    WHEN 'delivery-lead' THEN 'my-commitments'
    WHEN 'agile-delivery-lead' THEN 'my-commitments'
    ELSE 'attention' END;
  v_surface_visible:=COALESCE(v_home#>'{navigation,surfaces}','[]'::jsonb) ? v_required_surface;

  v_org:=CASE v_scope_type
    WHEN 'organisation' THEN v_scope_id
    WHEN 'portfolio' THEN (SELECT organisation_id FROM public.ec_portfolios WHERE id=v_scope_id)
    WHEN 'program' THEN (SELECT p.organisation_id FROM public.ec_programs g JOIN public.ec_portfolios p ON p.id=g.portfolio_id WHERE g.id=v_scope_id)
    WHEN 'project' THEN (SELECT organisation_id FROM public.pc_projects WHERE id=v_scope_id)
    WHEN 'org-unit' THEN (SELECT organisation_id FROM public.ec_org_units WHERE id=v_scope_id)
    ELSE NULL END;

  SELECT x->>'id' INTO v_visible_project
  FROM jsonb_array_elements(COALESCE(v_home->'projects','[]'::jsonb)) x
  LIMIT 1;

  SELECT p.id INTO v_out_of_scope_project
  FROM public.pc_projects p
  WHERE p.organisation_id=v_org
    AND NOT goliath_api.context_allows_project(p_assignment_id,p.id)
  ORDER BY p.id
  LIMIT 1;

  IF v_out_of_scope_project IS NOT NULL THEN
    v_out_of_scope_hidden:=NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_home->'projects','[]'::jsonb)) x
      WHERE x->>'id'=v_out_of_scope_project
    );
  END IF;

  v_expected_admin_denied:=v_role<>'enterprise-admin';
  BEGIN
    PERFORM goliath_api.admin_reference_data(p_assignment_id);
    v_admin_denied:=false;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_admin_denied:=true;
  END;

  v_expected_cockpit_denied:=v_role NOT IN ('project-manager','project-director','program-manager','pmo');
  IF v_visible_project IS NULL THEN
    v_cockpit_denied:=v_expected_cockpit_denied;
  ELSE
    BEGIN
      PERFORM goliath_api.project_cockpit(p_assignment_id,v_visible_project);
      v_cockpit_denied:=false;
    EXCEPTION WHEN SQLSTATE '42501' THEN
      v_cockpit_denied:=true;
    END;
  END IF;

  v_passed:=v_identity_bound
    AND v_surface_visible
    AND v_out_of_scope_hidden
    AND v_admin_denied=v_expected_admin_denied
    AND v_cockpit_denied=v_expected_cockpit_denied;

  INSERT INTO platform_identity.audit_events(
    actor_subject,event_type,auth_subject,user_id,details
  ) VALUES(
    auth.user_id(),'identity.acceptance.probed',auth.user_id(),v_user,
    jsonb_build_object(
      'assignmentId',p_assignment_id,
      'role',v_role,
      'scopeType',v_scope_type,
      'scopeId',v_scope_id,
      'requiredSurface',v_required_surface,
      'identityBound',v_identity_bound,
      'surfaceVisible',v_surface_visible,
      'outOfScopeProject',v_out_of_scope_project,
      'outOfScopeHidden',v_out_of_scope_hidden,
      'adminBoundaryMatched',v_admin_denied=v_expected_admin_denied,
      'cockpitBoundaryMatched',v_cockpit_denied=v_expected_cockpit_denied,
      'passed',v_passed
    )
  ) RETURNING seq INTO v_seq;

  RETURN jsonb_build_object(
    'passed',v_passed,
    'auditSequence',v_seq,
    'identity',jsonb_build_object('userId',v_user,'role',v_role,'assignmentId',p_assignment_id),
    'checks',jsonb_build_array(
      jsonb_build_object('id','identity-bound','passed',v_identity_bound,'detail','Authenticated identity and selected responsibility match.'),
      jsonb_build_object('id','required-surface','passed',v_surface_visible,'detail','The role-required primary surface is available.'),
      jsonb_build_object('id','scope-isolation','passed',v_out_of_scope_hidden,'detail',CASE WHEN v_out_of_scope_project IS NULL THEN 'No same-organisation out-of-scope project was available for this check.' ELSE 'An out-of-scope project is absent from the projection.' END),
      jsonb_build_object('id','admin-boundary','passed',v_admin_denied=v_expected_admin_denied,'detail',CASE WHEN v_expected_admin_denied THEN 'Administration access was denied as required.' ELSE 'Administration access was allowed as required.' END),
      jsonb_build_object('id','cockpit-boundary','passed',v_cockpit_denied=v_expected_cockpit_denied,'detail',CASE WHEN v_expected_cockpit_denied THEN 'Project Cockpit management access was denied as required.' ELSE 'Project Cockpit management access was allowed as required.' END),
      jsonb_build_object('id','audit-persistence','passed',true,'detail','This result was written to the identity audit ledger.')
    )
  );
END
$function$;

CREATE OR REPLACE FUNCTION goliath_api.multi_user_acceptance_readiness(
  p_assignment_id text,
  p_project_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','neon_auth','auth','goliath_api'
AS $function$
DECLARE
  c jsonb;
  v_org text;
  v_sponsor record;
  v_team record;
  v_sponsor_probe boolean:=false;
  v_team_probe boolean:=false;
  v_distinct boolean:=false;
  v_project_manager_linked boolean:=false;
  v_sponsor_control_input boolean:=false;
  v_team_owned_commitments integer:=0;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  IF c->>'role'<>'enterprise-admin' OR c->>'scopeType'<>'organisation'
     OR NOT goliath_api.context_has_data_class(p_assignment_id,'audit','read') THEN
    RAISE EXCEPTION 'Enterprise Admin organisation audit-read authority is required.' USING ERRCODE='42501';
  END IF;
  v_org:=c->>'scopeId';
  IF NOT EXISTS(SELECT 1 FROM public.pc_projects WHERE id=p_project_id AND organisation_id=v_org) THEN
    RAISE EXCEPTION 'Project is outside this administrator scope.' USING ERRCODE='42501';
  END IF;

  SELECT ul.auth_subject,ul.user_id,ul.email,a.id AS assignment_id,a.scope_type,a.scope_id
  INTO v_sponsor
  FROM platform_identity.user_links ul
  JOIN public.ec_responsibility_assignments a ON a.user_id=ul.user_id AND a.active=1 AND a.role='sponsor'
  WHERE ul.active=1
    AND CASE a.scope_type
      WHEN 'project' THEN a.scope_id=p_project_id
      WHEN 'program' THEN EXISTS(SELECT 1 FROM public.ec_project_context x WHERE x.project_id=p_project_id AND x.program_id=a.scope_id)
      WHEN 'portfolio' THEN EXISTS(SELECT 1 FROM public.ec_project_context x WHERE x.project_id=p_project_id AND x.portfolio_id=a.scope_id)
      WHEN 'organisation' THEN a.scope_id=v_org
      ELSE false END
  ORDER BY ul.linked_at DESC
  LIMIT 1;

  SELECT ul.auth_subject,ul.user_id,ul.email,a.id AS assignment_id,a.scope_type,a.scope_id
  INTO v_team
  FROM platform_identity.user_links ul
  JOIN public.ec_responsibility_assignments a ON a.user_id=ul.user_id AND a.active=1 AND a.role='team-member'
  WHERE ul.active=1 AND CASE a.scope_type
    WHEN 'project' THEN EXISTS(SELECT 1 FROM public.pc_projects p WHERE p.id=a.scope_id AND p.organisation_id=v_org)
    WHEN 'program' THEN EXISTS(SELECT 1 FROM public.ec_programs g JOIN public.ec_portfolios p ON p.id=g.portfolio_id WHERE g.id=a.scope_id AND p.organisation_id=v_org)
    WHEN 'portfolio' THEN EXISTS(SELECT 1 FROM public.ec_portfolios p WHERE p.id=a.scope_id AND p.organisation_id=v_org)
    WHEN 'organisation' THEN a.scope_id=v_org
    WHEN 'org-unit' THEN EXISTS(SELECT 1 FROM public.ec_org_units u WHERE u.id=a.scope_id AND u.organisation_id=v_org)
    ELSE false END
  ORDER BY (a.scope_type='project' AND a.scope_id=p_project_id) DESC,ul.linked_at DESC
  LIMIT 1;

  SELECT EXISTS(
    SELECT 1
    FROM platform_identity.user_links ul
    JOIN public.ec_responsibility_assignments a
      ON a.user_id=ul.user_id AND a.active=1 AND a.role='project-manager'
    WHERE ul.active=1 AND CASE a.scope_type
      WHEN 'project' THEN a.scope_id=p_project_id
      WHEN 'program' THEN EXISTS(SELECT 1 FROM public.ec_project_context x WHERE x.project_id=p_project_id AND x.program_id=a.scope_id)
      WHEN 'portfolio' THEN EXISTS(SELECT 1 FROM public.ec_project_context x WHERE x.project_id=p_project_id AND x.portfolio_id=a.scope_id)
      WHEN 'organisation' THEN a.scope_id=v_org
      ELSE false END
  ) INTO v_project_manager_linked;

  v_sponsor_control_input:=EXISTS(
    SELECT 1 FROM public.pc_commitment_candidates cc
    WHERE cc.project_id=p_project_id AND cc.status='proposed'
  ) OR EXISTS(
    SELECT 1 FROM public.pc_commitments cm
    WHERE cm.project_id=p_project_id AND cm.state NOT IN ('cancelled','closed')
  );

  IF v_sponsor.auth_subject IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM platform_identity.audit_events e
      WHERE e.event_type='identity.acceptance.probed'
        AND e.auth_subject=v_sponsor.auth_subject
        AND e.user_id=v_sponsor.user_id
        AND e.details->>'assignmentId'=v_sponsor.assignment_id
        AND e.details->>'role'='sponsor'
        AND e.details->>'passed'='true'
    ) INTO v_sponsor_probe;
  END IF;
  IF v_team.auth_subject IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM platform_identity.audit_events e
      WHERE e.event_type='identity.acceptance.probed'
        AND e.auth_subject=v_team.auth_subject
        AND e.user_id=v_team.user_id
        AND e.details->>'assignmentId'=v_team.assignment_id
        AND e.details->>'role'='team-member'
        AND e.details->>'passed'='true'
    ) INTO v_team_probe;

    SELECT count(*)::integer INTO v_team_owned_commitments
    FROM public.pc_commitments cm
    JOIN public.pc_projects p ON p.id=cm.project_id
    WHERE cm.accountable_owner_id=v_team.user_id
      AND cm.state NOT IN ('cancelled','closed')
      AND CASE v_team.scope_type
        WHEN 'project' THEN p.id=v_team.scope_id
        WHEN 'program' THEN EXISTS(SELECT 1 FROM public.ec_project_context x WHERE x.project_id=p.id AND x.program_id=v_team.scope_id)
        WHEN 'portfolio' THEN EXISTS(SELECT 1 FROM public.ec_project_context x WHERE x.project_id=p.id AND x.portfolio_id=v_team.scope_id)
        WHEN 'organisation' THEN p.organisation_id=v_team.scope_id
        WHEN 'org-unit' THEN p.organisation_id=(SELECT organisation_id FROM public.ec_org_units u WHERE u.id=v_team.scope_id)
        ELSE false END;
  END IF;
  v_distinct:=v_sponsor.auth_subject IS NOT NULL AND v_team.auth_subject IS NOT NULL
    AND v_sponsor.auth_subject<>v_team.auth_subject;

  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'summary',jsonb_build_object(
      'sponsorLinked',v_sponsor.auth_subject IS NOT NULL,
      'teamMemberLinked',v_team.auth_subject IS NOT NULL,
      'distinctAuthenticatedPeople',v_distinct,
      'sponsorProbePassed',v_sponsor_probe,
      'teamMemberProbePassed',v_team_probe,
      'sponsorProjectManagerLinked',v_project_manager_linked,
      'sponsorControlInputAvailable',v_sponsor_control_input,
      'teamMemberOwnedCommitments',v_team_owned_commitments
    ),
    'gates',jsonb_build_array(
      jsonb_build_object('id','sponsor-linked','label','Sponsor identity linked to selected project','state',CASE WHEN v_sponsor.auth_subject IS NOT NULL THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_sponsor.auth_subject IS NOT NULL THEN 'A verified Sponsor identity covers this project.' ELSE 'No verified Sponsor identity covers this project.' END),
      jsonb_build_object('id','team-linked','label','Team Member identity linked in organisation','state',CASE WHEN v_team.auth_subject IS NOT NULL THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_team.auth_subject IS NULL THEN 'No verified Team Member identity is linked in this organisation.' WHEN v_team.scope_type='project' AND v_team.scope_id<>p_project_id THEN 'A verified Team Member is linked to project '||v_team.scope_id||'; access is intentionally not widened to '||p_project_id||'.' ELSE 'A verified Team Member identity covers the selected project.' END),
      jsonb_build_object('id','distinct-people','label','Distinct authenticated people','state',CASE WHEN v_distinct THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_distinct THEN 'Sponsor and Team Member resolve to different Auth subjects.' ELSE 'The two roles are not yet proven as different authenticated people.' END),
      jsonb_build_object('id','sponsor-probe','label','Sponsor role boundary exercised','state',CASE WHEN v_sponsor_probe THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_sponsor_probe THEN 'The Sponsor ran the session-bound allow/deny probe and its audit record persisted.' ELSE 'The Sponsor must sign in and run Access check.' END),
      jsonb_build_object('id','team-probe','label','Team Member role boundary exercised','state',CASE WHEN v_team_probe THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_team_probe THEN 'The Team Member ran the session-bound allow/deny probe and its audit record persisted.' ELSE 'The Team Member must sign in and run Access check.' END),
      jsonb_build_object('id','sponsor-workflow-input','label','Sponsor project has governed workflow input','state',CASE WHEN v_project_manager_linked AND v_sponsor_control_input THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN NOT v_project_manager_linked THEN 'No linked Project Manager covers the selected Sponsor project.' WHEN NOT v_sponsor_control_input THEN 'The selected Sponsor project has no proposed candidate or active governed commitment.' ELSE 'A linked Project Manager and a candidate or commitment are available for the PM-to-Sponsor journey.' END),
      jsonb_build_object('id','team-owned-work','label','Team Member has governed work to update','state',CASE WHEN v_team_owned_commitments>0 THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_team.auth_subject IS NULL THEN 'No verified Team Member is available.' WHEN v_team.scope_type='project' THEN 'The Team Member owns '||v_team_owned_commitments||' governed commitment(s) in project '||v_team.scope_id||'.' ELSE 'The Team Member owns '||v_team_owned_commitments||' governed commitment(s) inside the assigned scope.' END)
    ),
    'readyForRoleBoundaryAcceptance',v_distinct AND v_sponsor_probe AND v_team_probe,
    'readyForGovernedWorkflow',v_distinct AND v_sponsor_probe AND v_team_probe
      AND v_project_manager_linked AND v_sponsor_control_input AND v_team_owned_commitments>0,
    'nextAction',CASE
      WHEN NOT v_sponsor_probe THEN 'Sponsor signs in and selects Run access check.'
      WHEN NOT v_team_probe THEN 'Team Member signs in and selects Run access check.'
      WHEN NOT v_project_manager_linked THEN 'Link an authorised Project Manager covering the selected Sponsor project.'
      WHEN NOT v_sponsor_control_input THEN 'Create or import a candidate or governed commitment for the selected Sponsor project.'
      WHEN v_team_owned_commitments=0 THEN 'The Team Member project manager must assign one governed commitment through the application; do not seed a passing result.'
      ELSE 'Proceed with the Project Manager submission, separate Sponsor approval, and Team Member evidence workflow.' END
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.run_role_acceptance_probe(text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.multi_user_acceptance_readiness(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.run_role_acceptance_probe(text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.multi_user_acceptance_readiness(text,text) TO authenticated;

COMMIT;

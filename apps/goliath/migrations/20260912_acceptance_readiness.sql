-- Development/release acceptance readiness projection.
-- This is diagnostic only; it does not grant authority or mutate project state.

CREATE OR REPLACE FUNCTION goliath_api.acceptance_readiness(p_assignment_id text,p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','neon_auth','auth','goliath_api'
AS $function$
DECLARE
  ctx jsonb;
  v_project record;
  v_supported_roles integer;
  v_covered_roles integer;
  v_auth_users integer;
  v_linked_identities integer;
  v_project_linked_identities integer;
  v_commitments integer;
  v_candidates integer;
  v_missing_specs integer;
  v_baselines integer;
  v_requirements integer;
  v_raid integer;
  v_decisions integer;
  v_dependencies integer;
  v_sources integer;
  v_bindings integer;
  v_critical_recon integer;
  v_separate_approver boolean;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role'<>'enterprise-admin' OR NOT goliath_api.context_has_data_class(p_assignment_id,'audit','read') THEN
    RAISE EXCEPTION 'Enterprise Admin audit-read authority is required.' USING ERRCODE='42501';
  END IF;
  SELECT p.id,p.name,p.organisation_id,c.program_id,c.portfolio_id INTO v_project
  FROM public.pc_projects p LEFT JOIN public.ec_project_context c ON c.project_id=p.id
  WHERE p.id=p_project_id;
  IF NOT FOUND OR (ctx->>'scopeType'='organisation' AND v_project.organisation_id<>(ctx->>'scopeId')) THEN
    RAISE EXCEPTION 'Project is outside this administrator scope.' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_supported_roles FROM platform_identity.role_catalog WHERE active=1;
  SELECT count(DISTINCT a.role) INTO v_covered_roles
  FROM public.ec_responsibility_assignments a
  WHERE a.active=1 AND CASE a.scope_type
    WHEN 'project' THEN a.scope_id=p_project_id
    WHEN 'program' THEN a.scope_id=v_project.program_id
    WHEN 'portfolio' THEN a.scope_id=v_project.portfolio_id
    WHEN 'organisation' THEN a.scope_id=v_project.organisation_id
    WHEN 'org-unit' THEN (SELECT organisation_id FROM public.ec_org_units u WHERE u.id=a.scope_id)=v_project.organisation_id
    ELSE false END;

  SELECT count(*) INTO v_auth_users FROM neon_auth."user";
  SELECT count(DISTINCT auth_subject) INTO v_linked_identities FROM platform_identity.user_links WHERE active=1;
  SELECT count(DISTINCT ul.auth_subject) INTO v_project_linked_identities
  FROM platform_identity.user_links ul
  JOIN public.ec_responsibility_assignments a ON a.user_id=ul.user_id AND a.active=1
  WHERE ul.active=1 AND CASE a.scope_type
    WHEN 'project' THEN a.scope_id=p_project_id
    WHEN 'program' THEN a.scope_id=v_project.program_id
    WHEN 'portfolio' THEN a.scope_id=v_project.portfolio_id
    WHEN 'organisation' THEN a.scope_id=v_project.organisation_id
    WHEN 'org-unit' THEN (SELECT organisation_id FROM public.ec_org_units u WHERE u.id=a.scope_id)=v_project.organisation_id
    ELSE false END;

  SELECT count(*) INTO v_commitments FROM public.pc_commitments WHERE project_id=p_project_id AND state NOT IN ('proposed','cancelled','waived','closed');
  SELECT count(*) INTO v_candidates FROM public.pc_commitment_candidates WHERE project_id=p_project_id AND status='proposed';
  SELECT count(*) INTO v_missing_specs FROM public.pc_commitments WHERE project_id=p_project_id AND state NOT IN ('proposed','cancelled','waived','closed') AND jsonb_array_length(evidence_spec_json::jsonb)=0;
  SELECT count(*) INTO v_baselines FROM public.pc_baselines WHERE project_id=p_project_id AND state='approved';
  SELECT count(*) INTO v_requirements FROM public.pc_requirements WHERE project_id=p_project_id AND state NOT IN ('rejected','retired');
  SELECT count(*) INTO v_raid FROM public.pc_raid_items WHERE project_id=p_project_id AND state NOT IN ('closed','resolved');
  SELECT count(*) INTO v_decisions FROM public.pc_decisions WHERE project_id=p_project_id;
  SELECT count(*) INTO v_dependencies FROM public.pc_commitment_dependencies WHERE project_id=p_project_id;
  SELECT count(*) INTO v_sources FROM public.pc_sources WHERE project_id=p_project_id;
  SELECT count(*) INTO v_bindings FROM public.integration_bindings_v2 WHERE project_id=p_project_id AND enabled=1;
  SELECT count(*) INTO v_critical_recon FROM public.integration_reconciliation_issues_v2 WHERE project_id=p_project_id AND state IN ('open','acknowledged') AND severity='critical';

  SELECT EXISTS(
    SELECT 1
    FROM platform_identity.user_links ul
    JOIN public.ec_responsibility_assignments a ON a.user_id=ul.user_id AND a.active=1
    WHERE ul.active=1 AND a.role IN ('sponsor','project-director','program-manager')
      AND ul.user_id<>(ctx->>'userId')
      AND CASE a.scope_type
        WHEN 'project' THEN a.scope_id=p_project_id
        WHEN 'program' THEN a.scope_id=v_project.program_id
        WHEN 'portfolio' THEN a.scope_id=v_project.portfolio_id
        WHEN 'organisation' THEN a.scope_id=v_project.organisation_id
        ELSE false END
  ) INTO v_separate_approver;

  RETURN jsonb_build_object(
    'project',jsonb_build_object('id',v_project.id,'name',v_project.name),
    'summary',jsonb_build_object(
      'supportedRoles',v_supported_roles,'rolesCoveringProject',v_covered_roles,
      'authUsers',v_auth_users,'linkedIdentities',v_linked_identities,'projectLinkedIdentities',v_project_linked_identities,
      'commitmentCandidates',v_candidates,'controlledCommitments',v_commitments,'commitmentsMissingEvidenceSpec',v_missing_specs,
      'approvedBaselines',v_baselines,'requirements',v_requirements,'raidItems',v_raid,
      'decisions',v_decisions,'dependencies',v_dependencies,'sources',v_sources,'enabledConnectors',v_bindings,
      'criticalReconciliationIssues',v_critical_recon
    ),
    'gates',jsonb_build_array(
      jsonb_build_object('id','named-user-auth','label','First named-user authentication','state',CASE WHEN v_linked_identities>=1 THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_linked_identities>=1 THEN 'At least one verified Auth identity is linked to Goliath.' ELSE 'No verified Auth identity is linked.' END),
      jsonb_build_object('id','role-coverage','label','Supported role coverage','state',CASE WHEN v_covered_roles>=v_supported_roles THEN 'pass' ELSE 'blocked' END,'reason',v_covered_roles||' of '||v_supported_roles||' supported roles cover this project.'),
      jsonb_build_object('id','second-identity','label','Second real identity','state',CASE WHEN v_project_linked_identities>=2 THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_project_linked_identities>=2 THEN 'At least two distinct real identities cover the project.' ELSE 'A second verified identity is required for cross-user acceptance.' END),
      jsonb_build_object('id','separate-approver','label','Separate named approver','state',CASE WHEN v_separate_approver THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_separate_approver THEN 'A different linked Sponsor/Director/Program Manager is available.' ELSE 'No different linked approval identity is available yet.' END),
      jsonb_build_object('id','control-established','label','Project control established','state',CASE WHEN v_commitments>0 THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_commitments>0 THEN v_commitments||' governed commitment(s) exist.' ELSE v_candidates||' candidate(s) remain; no governed commitment has been confirmed.' END),
      jsonb_build_object('id','evidence-specification','label','Evidence specifications','state',CASE WHEN v_commitments>0 AND v_missing_specs=0 THEN 'pass' WHEN v_commitments=0 THEN 'not-applicable-yet' ELSE 'blocked' END,'reason',CASE WHEN v_commitments=0 THEN 'Activate after commitments are confirmed.' WHEN v_missing_specs=0 THEN 'All controlled commitments have evidence specifications.' ELSE v_missing_specs||' commitment(s) are missing evidence specifications.' END),
      jsonb_build_object('id','initial-baseline','label','Approved initial baseline','state',CASE WHEN v_baselines>0 THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_baselines>0 THEN 'An immutable approved baseline exists.' ELSE 'Initial baseline has not yet been approved.' END),
      jsonb_build_object('id','critical-reconciliation','label','No critical reconciliation ambiguity','state',CASE WHEN v_critical_recon=0 THEN 'pass' ELSE 'blocked' END,'reason',CASE WHEN v_critical_recon=0 THEN 'No critical open reconciliation issue.' ELSE v_critical_recon||' critical reconciliation issue(s) remain.' END)
    ),
    'releaseReady',false,
    'releaseReadyReason','Hosted OAuth/network/browser acceptance and multi-user separation-of-duties are required before production release.'
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.acceptance_readiness(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.acceptance_readiness(text,text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.acceptance_readiness(text,text) TO authenticated;

-- Role-aware MVP control read model.
-- Browser surfaces are projections over governed domain objects, not direct table reads.

BEGIN;

CREATE OR REPLACE FUNCTION goliath_api.mvp_navigation(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_role text; v_surfaces jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id); v_role:=c->>'role';
  v_surfaces:=CASE v_role
    WHEN 'enterprise-admin' THEN '["administration"]'::jsonb
    WHEN 'resource-manager' THEN '["capacity"]'::jsonb
    WHEN 'sponsor' THEN '["decisions","overview"]'::jsonb
    WHEN 'portfolio-manager' THEN '["attention","projects"]'::jsonb
    WHEN 'program-manager' THEN '["attention","projects","decisions","dependencies"]'::jsonb
    WHEN 'project-director' THEN '["attention","overview","commitments","decisions","dependencies"]'::jsonb
    WHEN 'project-manager' THEN '["attention","overview","commitments","decisions","dependencies"]'::jsonb
    WHEN 'pmo' THEN '["controls","projects","decisions","dependencies"]'::jsonb
    WHEN 'delivery-lead' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    WHEN 'agile-delivery-lead' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    WHEN 'team-member' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    ELSE '[]'::jsonb END;
  RETURN jsonb_build_object(
    'assignmentId',c->>'assignmentId','role',v_role,'scopeType',c->>'scopeType','scopeId',c->>'scopeId',
    'teamId',c->>'teamId','surfaces',v_surfaces,
    'defaultSurface',CASE WHEN jsonb_array_length(v_surfaces)>0 THEN v_surfaces->>0 ELSE NULL END
  );
END $$;

CREATE OR REPLACE FUNCTION goliath_api.scoped_project_list(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  IF c->>'role' IN ('enterprise-admin','resource-manager') THEN RETURN '[]'::jsonb; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',p.id,'code',p.code,'name',p.name,'lifecycle',p.lifecycle,
      'baselineFinish',p.baseline_finish,'forecastFinish',p.forecast_finish,
      'evidenceConfidence',p.evidence_confidence,'sourceHealthSummary',p.source_health_summary,
      'commitmentCount',(SELECT count(*) FROM public.pc_commitments cmt WHERE cmt.project_id=p.id AND cmt.state NOT IN ('cancelled','closed')),
      'candidateCount',(SELECT count(*) FROM public.pc_commitment_candidates cc WHERE cc.project_id=p.id AND cc.status='proposed'),
      'pendingDecisionCount',(SELECT count(*) FROM public.pc_decisions d WHERE d.project_id=p.id AND d.state='pending'),
      'openDependencyCount',(SELECT count(*) FROM public.pc_commitment_dependencies dep WHERE dep.project_id=p.id AND dep.state NOT IN ('accepted','cancelled')),
      'sourceState',COALESCE((SELECT jsonb_agg(jsonb_build_object('type',s.source_type,'ref',s.source_ref,'status',s.status,'lastObservedAt',s.last_observed_at,'freshnessHours',s.freshness_hours) ORDER BY s.id) FROM public.pc_sources s WHERE s.project_id=p.id),'[]'::jsonb)
    ) ORDER BY p.name)
    FROM public.pc_projects p
    WHERE goliath_api.context_allows_project(p_assignment_id,p.id)
  ),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.my_commitments(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_user text; v_role text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id); v_user:=c->>'userId'; v_role:=c->>'role';
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',cm.id,'projectId',cm.project_id,'workstreamId',cm.workstream_id,'type',cm.type,'title',cm.title,
      'ownerId',cm.accountable_owner_id,'committedDate',cm.committed_date,'dateKind',cm.committed_date_kind,
      'forecastDate',cm.forecast_date,'acceptanceCriteria',cm.acceptance_criteria,'evidenceMaturity',cm.evidence_maturity,
      'state',cm.state,'origin',cm.origin,'revision',cm.revision,
      'evidenceSpec',cm.evidence_spec_json::jsonb,
      'health',CASE WHEN cm.state IN ('active','ready-for-acceptance') THEN goliath_api.commitment_health_projection(p_assignment_id,cm.id) ELSE NULL END,
      'pendingDecisions',(SELECT count(*) FROM public.pc_decision_commitments dc JOIN public.pc_decisions d ON d.id=dc.decision_id WHERE dc.commitment_id=cm.id AND d.state='pending'),
      'openDependencies',(SELECT count(*) FROM public.pc_commitment_dependencies dep WHERE dep.consumer_commitment_id=cm.id AND dep.state NOT IN ('accepted','cancelled'))
    ) ORDER BY cm.committed_date NULLS LAST,cm.title)
    FROM public.pc_commitments cm
    WHERE goliath_api.context_allows_project(p_assignment_id,cm.project_id)
      AND cm.state NOT IN ('cancelled','closed')
      AND (
        cm.accountable_owner_id=v_user
        OR v_role IN ('project-manager','project-director','program-manager','pmo')
      )
  ),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.project_cockpit(p_assignment_id text,p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_role text; p public.pc_projects%ROWTYPE; health jsonb; commitments jsonb; candidates jsonb; decisions jsonb; dependencies jsonb; sources jsonb; workstreams jsonb; latest_pm jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id); v_role:=c->>'role';
  IF v_role NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'Project Cockpit is not available to this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.pc_projects WHERE id=p_project_id;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;

  health:=goliath_api.project_health_projection(p_assignment_id,p_project_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'methodology',w.methodology,'active',w.active=1) ORDER BY w.name),'[]'::jsonb) INTO workstreams FROM public.pc_workstreams w WHERE w.project_id=p_project_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',cm.id,'workstreamId',cm.workstream_id,'type',cm.type,'title',cm.title,'ownerId',cm.accountable_owner_id,'committedDate',cm.committed_date,'forecastDate',cm.forecast_date,'acceptanceCriteria',cm.acceptance_criteria,'evidenceSpec',cm.evidence_spec_json::jsonb,'evidenceMaturity',cm.evidence_maturity,'state',cm.state,'origin',cm.origin,'revision',cm.revision) ORDER BY cm.committed_date NULLS LAST,cm.title),'[]'::jsonb) INTO commitments FROM public.pc_commitments cm WHERE cm.project_id=p_project_id AND cm.state NOT IN ('cancelled','closed');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',cc.id,'sourceRef',cc.source_ref,'type',cc.proposed_type,'title',cc.proposed_title,'ownerId',cc.proposed_owner_id,'date',cc.proposed_date,'confidence',cc.confidence,'status',cc.status) ORDER BY cc.proposed_date NULLS LAST,cc.proposed_title),'[]'::jsonb) INTO candidates FROM public.pc_commitment_candidates cc WHERE cc.project_id=p_project_id AND cc.status='proposed';
  decisions:=goliath_api.decision_queue(p_assignment_id);
  dependencies:=goliath_api.dependency_queue(p_assignment_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'type',s.source_type,'ref',s.source_ref,'authority',s.authority,'status',s.status,'lastObservedAt',s.last_observed_at,'freshnessHours',s.freshness_hours,'classification',s.classification) ORDER BY s.id),'[]'::jsonb) INTO sources FROM public.pc_sources s WHERE s.project_id=p_project_id;
  SELECT jsonb_build_object('state',a.state,'reason',a.reason,'assessorId',a.assessor_id,'assessedAt',a.assessed_at) INTO latest_pm FROM public.pc_pm_assessments a WHERE a.project_id=p_project_id AND a.commitment_id IS NULL ORDER BY a.assessed_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'project',jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'lifecycle',p.lifecycle,'baselineFinish',p.baseline_finish,'forecastFinish',p.forecast_finish,'evidenceConfidence',p.evidence_confidence,'sourceHealthSummary',p.source_health_summary),
    'workstreams',workstreams,'commitments',commitments,'commitmentCandidates',candidates,
    'health',health,'pmAssessment',latest_pm,
    'decisions',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(decisions) x WHERE x->>'projectId'=p_project_id),
    'dependencies',(SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM jsonb_array_elements(dependencies) x WHERE x->>'projectId'=p_project_id),
    'sources',sources,
    'readiness',jsonb_build_object(
      'hasWorkstreamMethodology',EXISTS(SELECT 1 FROM public.pc_workstreams w WHERE w.project_id=p_project_id AND w.active=1 AND w.methodology<>'unspecified'),
      'confirmedCommitments',(SELECT count(*) FROM public.pc_commitments cm WHERE cm.project_id=p_project_id AND cm.state NOT IN ('cancelled','closed')),
      'proposedCandidates',(SELECT count(*) FROM public.pc_commitment_candidates cc WHERE cc.project_id=p_project_id AND cc.status='proposed'),
      'activeCommitments',(SELECT count(*) FROM public.pc_commitments cm WHERE cm.project_id=p_project_id AND cm.state IN ('active','ready-for-acceptance')),
      'sourceCount',(SELECT count(*) FROM public.pc_sources s WHERE s.project_id=p_project_id)
    )
  );
END $$;

CREATE OR REPLACE FUNCTION goliath_api.control_home(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; nav jsonb; v_role text; projects jsonb; mine jsonb; decisions jsonb; deps jsonb; debt jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id); v_role:=c->>'role'; nav:=goliath_api.mvp_navigation(p_assignment_id);
  projects:=CASE WHEN v_role IN ('enterprise-admin','resource-manager') THEN '[]'::jsonb ELSE goliath_api.scoped_project_list(p_assignment_id) END;
  mine:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','sponsor','portfolio-manager') THEN '[]'::jsonb ELSE goliath_api.my_commitments(p_assignment_id) END;
  decisions:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','portfolio-manager') THEN '[]'::jsonb ELSE goliath_api.decision_queue(p_assignment_id) END;
  deps:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','portfolio-manager','sponsor') THEN '[]'::jsonb ELSE goliath_api.dependency_queue(p_assignment_id) END;
  debt:=CASE WHEN v_role IN ('enterprise-admin','resource-manager') THEN NULL ELSE goliath_api.decision_debt_summary(p_assignment_id) END;
  RETURN jsonb_build_object('identity',jsonb_build_object('userId',c->>'userId','displayName',c->>'displayName','role',v_role,'scopeType',c->>'scopeType','scopeId',c->>'scopeId','teamId',c->>'teamId'),'navigation',nav,'projects',projects,'myCommitments',mine,'decisions',decisions,'dependencies',deps,'decisionDebt',debt);
END $$;

REVOKE ALL ON FUNCTION goliath_api.mvp_navigation(text), goliath_api.scoped_project_list(text), goliath_api.my_commitments(text), goliath_api.project_cockpit(text,text), goliath_api.control_home(text) FROM PUBLIC, anonymous, goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.mvp_navigation(text), goliath_api.scoped_project_list(text), goliath_api.my_commitments(text), goliath_api.project_cockpit(text,text), goliath_api.control_home(text) TO authenticated;

COMMIT;

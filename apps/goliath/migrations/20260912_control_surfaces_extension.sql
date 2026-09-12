-- Extend governed navigation/project control projections after RAID/requirements/change foundations.
BEGIN;

CREATE OR REPLACE FUNCTION goliath_api.mvp_navigation(p_assignment_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_role text; v_surfaces jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id); v_role:=c->>'role';
  v_surfaces:=CASE v_role
    WHEN 'enterprise-admin' THEN '["administration"]'::jsonb
    WHEN 'resource-manager' THEN '["capacity"]'::jsonb
    WHEN 'sponsor' THEN '["decisions","overview","reports"]'::jsonb
    WHEN 'portfolio-manager' THEN '["attention","projects"]'::jsonb
    WHEN 'program-manager' THEN '["attention","projects","decisions","dependencies","raid","change","reports"]'::jsonb
    WHEN 'project-director' THEN '["attention","overview","commitments","requirements","decisions","dependencies","raid","change","reports"]'::jsonb
    WHEN 'project-manager' THEN '["attention","overview","commitments","requirements","decisions","dependencies","raid","change","reports"]'::jsonb
    WHEN 'pmo' THEN '["controls","projects","requirements","decisions","dependencies","raid","change","reports"]'::jsonb
    WHEN 'delivery-lead' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    WHEN 'agile-delivery-lead' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    WHEN 'team-member' THEN '["my-commitments","decisions","dependencies"]'::jsonb
    ELSE '[]'::jsonb END;
  RETURN jsonb_build_object('assignmentId',c->>'assignmentId','role',v_role,'scopeType',c->>'scopeType','scopeId',c->>'scopeId','teamId',c->>'teamId','surfaces',v_surfaces,'defaultSurface',CASE WHEN jsonb_array_length(v_surfaces)>0 THEN v_surfaces->>0 ELSE NULL END);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.project_control_extensions(p_assignment_id text,p_project_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'baseline',goliath_api.baseline_status(p_assignment_id,p_project_id),
    'requirements',goliath_api.requirements_view(p_assignment_id,p_project_id),
    'raid',goliath_api.raid_board(p_assignment_id,p_project_id),
    'change',goliath_api.change_desk(p_assignment_id,p_project_id)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.project_report_full(
  p_assignment_id text,p_project_id text,p_audience text,p_period_kind text DEFAULT 'current',p_period_start text DEFAULT NULL,p_period_end text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE base jsonb; reqs jsonb; changes jsonb; baseline jsonb;
BEGIN
  base:=goliath_api.project_report_with_raid(p_assignment_id,p_project_id,p_audience,p_period_kind,p_period_start,p_period_end);
  baseline:=goliath_api.baseline_status(p_assignment_id,p_project_id);
  IF p_audience='client' THEN
    RETURN jsonb_set(jsonb_set(base,'{sections,forAwareness,baseline}',baseline,true),'{sections,forDiscussion,scopeControl}',jsonb_build_object('disclosure','Internal requirement/change-control detail withheld until explicitly client-visible.'),true);
  END IF;
  reqs:=goliath_api.requirements_view(p_assignment_id,p_project_id);
  changes:=goliath_api.change_desk(p_assignment_id,p_project_id);
  base:=jsonb_set(base,'{sections,forAwareness,baseline}',baseline,true);
  base:=jsonb_set(base,'{sections,forAwareness,requirements}',reqs,true);
  base:=jsonb_set(base,'{sections,forDiscussion,changeControl}',changes,true);
  RETURN base;
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.snapshot_project_report(
  p_assignment_id text,p_project_id text,p_audience text,p_period_kind text DEFAULT 'weekly',p_period_start text DEFAULT NULL,p_period_end text DEFAULT NULL,p_external_approval_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; projection jsonb; v_id text:='rpt-'||gen_random_uuid()::text; v_hash text; v_headline text; v_data_as_of text; v_approval_state text:='draft';
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','program-manager','pmo','sponsor') THEN RAISE EXCEPTION 'This responsibility cannot snapshot project reports.' USING ERRCODE='42501'; END IF;
  IF p_audience='client' THEN
    IF ctx->>'role' NOT IN ('project-manager','project-director') THEN RAISE EXCEPTION 'Only the Project Manager or Project Director may approve an external client report.' USING ERRCODE='42501'; END IF;
    IF COALESCE(length(trim(p_external_approval_reason)),0)<5 THEN RAISE EXCEPTION 'External client report requires an explicit human approval reason.' USING ERRCODE='22023'; END IF;
    v_approval_state:='approved';
  END IF;
  projection:=goliath_api.project_report_full(p_assignment_id,p_project_id,p_audience,p_period_kind,p_period_start,p_period_end);
  v_data_as_of:=projection->>'dataAsOf';
  v_headline:=COALESCE(projection#>>'{project,name}','Project')||' · '||COALESCE(projection#>>'{health,state}','data-insufficient');
  v_hash:=encode(digest(projection::text,'sha256'),'hex');
  INSERT INTO public.pc_report_snapshots(id,project_id,audience,generated_at,headline,projection_hash,projection_json,source_refs_json,report_type,period_kind,period_start,period_end,generated_by,approval_state,approved_by,approved_at,approval_reason,distribution_state,data_as_of,evidence_versions_json,revision)
  VALUES(v_id,p_project_id,p_audience,now()::text,v_headline,v_hash,projection::text,COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',s.id,'sourceRef',s.source_ref,'lastObservedAt',s.last_observed_at,'revision',s.revision) ORDER BY s.id)::text FROM public.pc_sources s WHERE s.project_id=p_project_id),'[]'),'weekly-status',p_period_kind,p_period_start,p_period_end,ctx->>'userId',v_approval_state,CASE WHEN v_approval_state='approved' THEN ctx->>'userId' ELSE NULL END,CASE WHEN v_approval_state='approved' THEN now()::text ELSE NULL END,NULLIF(trim(p_external_approval_reason),''),'not-distributed',v_data_as_of,COALESCE((SELECT jsonb_agg(jsonb_build_object('commitmentId',c.id,'revision',c.revision) ORDER BY c.id)::text FROM public.pc_commitments c WHERE c.project_id=p_project_id),'[]'),1);
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','report.snapshot.created','report-snapshot',v_id,'recorded',CASE WHEN p_audience='client' THEN trim(p_external_approval_reason) ELSE 'Governed report snapshot created.' END,NULL,1,jsonb_build_object('audience',p_audience,'periodKind',p_period_kind,'projectionHash',v_hash,'approvalState',v_approval_state));
  RETURN jsonb_build_object('snapshotId',v_id,'projectId',p_project_id,'audience',p_audience,'projectionHash',v_hash,'approvalState',v_approval_state,'distributionState','not-distributed');
END
$$;

REVOKE ALL ON FUNCTION goliath_api.project_control_extensions(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.project_report_full(text,text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.project_control_extensions(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.project_report_full(text,text,text,text,text,text) TO authenticated;

COMMIT;

-- Goliath reporting projection foundation
-- Date: 2026-09-12
-- Purpose: Preserve familiar PM reporting as projections of the governed model.
-- Reports never become a separate source of truth and unsupported metrics remain unavailable.

BEGIN;

ALTER TABLE public.pc_report_snapshots
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'weekly-status',
  ADD COLUMN IF NOT EXISTS period_kind text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS period_start text,
  ADD COLUMN IF NOT EXISTS period_end text,
  ADD COLUMN IF NOT EXISTS generated_by text,
  ADD COLUMN IF NOT EXISTS approval_state text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at text,
  ADD COLUMN IF NOT EXISTS approval_reason text,
  ADD COLUMN IF NOT EXISTS distribution_state text NOT NULL DEFAULT 'not-distributed',
  ADD COLUMN IF NOT EXISTS distributed_at text,
  ADD COLUMN IF NOT EXISTS data_as_of text,
  ADD COLUMN IF NOT EXISTS evidence_versions_json text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='pc_report_snapshots_audience_check'
      AND conrelid='public.pc_report_snapshots'::regclass
  ) THEN
    ALTER TABLE public.pc_report_snapshots DROP CONSTRAINT pc_report_snapshots_audience_check;
  END IF;
END $$;

ALTER TABLE public.pc_report_snapshots
  ADD CONSTRAINT pc_report_snapshots_audience_check
    CHECK (audience IN ('pm','program','sponsor','leadership','client','delivery','pmo','portfolio')),
  ADD CONSTRAINT pc_report_snapshots_report_type_check
    CHECK (report_type IN ('weekly-status','executive-status','milestone-status','schedule','raid','decision-log','dependency-log','capacity','portfolio-status','custom')),
  ADD CONSTRAINT pc_report_snapshots_period_kind_check
    CHECK (period_kind IN ('current','daily','weekly','week-to-date','monthly','month-to-date','custom')),
  ADD CONSTRAINT pc_report_snapshots_approval_state_check
    CHECK (approval_state IN ('draft','approved','rejected')),
  ADD CONSTRAINT pc_report_snapshots_distribution_state_check
    CHECK (distribution_state IN ('not-distributed','distributed'));

CREATE INDEX IF NOT EXISTS idx_pc_report_snapshots_project_time
  ON public.pc_report_snapshots(project_id,generated_at DESC,audience,report_type);

CREATE OR REPLACE FUNCTION goliath_api.report_capability_catalog(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  ctx jsonb;
  v_activity_count integer;
  v_dated_activity_count integer;
  v_commitment_count integer;
  v_milestone_count integer;
  v_agile_stream_count integer;
  v_resource_count integer;
  v_raid_ready boolean := false;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN
    RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501';
  END IF;

  SELECT count(*),count(*) FILTER (WHERE baseline_start IS NOT NULL AND baseline_finish IS NOT NULL)
    INTO v_activity_count,v_dated_activity_count
  FROM public.pc_activities WHERE project_id=p_project_id;

  SELECT count(*),count(*) FILTER (WHERE type='milestone')
    INTO v_commitment_count,v_milestone_count
  FROM public.pc_commitments
  WHERE project_id=p_project_id AND state NOT IN ('cancelled','closed');

  SELECT count(*) INTO v_agile_stream_count
  FROM public.pc_workstreams
  WHERE project_id=p_project_id AND active=1 AND methodology IN ('agile','hybrid');

  SELECT count(DISTINCT r.id) INTO v_resource_count
  FROM public.rc_resources r
  JOIN public.rc_allocations a ON a.resource_id=r.id
  WHERE a.project_id=p_project_id AND a.status<>'released';

  RETURN jsonb_build_array(
    jsonb_build_object('report','executive-status','available',true,'basis','Governed commitments, health, decisions and dependencies'),
    jsonb_build_object('report','milestone-status','available',(v_milestone_count>0 OR v_commitment_count>0),'basis','Confirmed commitments; imported milestones remain candidates until confirmed'),
    jsonb_build_object('report','gantt','available',(v_dated_activity_count>0),'basis',CASE WHEN v_dated_activity_count>0 THEN 'External/imported dated execution plan rendered as a view only' ELSE 'No dated source-plan rows' END),
    jsonb_build_object('report','burndown','available',false,'basis',CASE WHEN v_agile_stream_count=0 THEN 'No Agile/Hybrid workstream configured' ELSE 'Historical iteration/time-series scope and completion snapshots are not yet captured' END,'minimumData','Iteration boundaries plus historical scope/completion series'),
    jsonb_build_object('report','burnup','available',false,'basis',CASE WHEN v_agile_stream_count=0 THEN 'No Agile/Hybrid workstream configured' ELSE 'Historical scope and accepted-work series are not yet captured' END,'minimumData','Historical total-scope and accepted-work series'),
    jsonb_build_object('report','raid','available',v_raid_ready,'basis','First-class linked Risk/Issue/Assumption model is not implemented yet; dependencies are available separately'),
    jsonb_build_object('report','decision-log','available',true,'basis','Governed decision objects'),
    jsonb_build_object('report','dependency-log','available',true,'basis','Two-party commitment dependencies'),
    jsonb_build_object('report','capacity','available',(v_resource_count>0),'basis',CASE WHEN v_resource_count>0 THEN 'Governed resource allocations/capacity' ELSE 'No governed resource allocation data for this project' END)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.project_report_preview(
  p_assignment_id text,
  p_project_id text,
  p_audience text,
  p_period_kind text DEFAULT 'current',
  p_period_start text DEFAULT NULL,
  p_period_end text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  ctx jsonb;
  cockpit jsonb;
  health jsonb;
  v_project jsonb;
  v_data_as_of text;
  v_commitments jsonb;
  v_decisions jsonb;
  v_dependencies jsonb;
  v_sources jsonb;
  v_capabilities jsonb;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF p_audience NOT IN ('pm','program','sponsor','leadership','client','delivery','pmo','portfolio') THEN
    RAISE EXCEPTION 'Unsupported report audience.' USING ERRCODE='22023';
  END IF;
  IF p_period_kind NOT IN ('current','daily','weekly','week-to-date','monthly','month-to-date','custom') THEN
    RAISE EXCEPTION 'Unsupported reporting period.' USING ERRCODE='22023';
  END IF;
  IF p_period_kind='custom' AND (p_period_start IS NULL OR p_period_end IS NULL) THEN
    RAISE EXCEPTION 'Custom reporting period requires start and end dates.' USING ERRCODE='22023';
  END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN
    RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501';
  END IF;

  -- Cockpit is used as the canonical management projection, not as a report-owned dataset.
  IF ctx->>'role' IN ('project-manager','project-director','program-manager','pmo') THEN
    cockpit:=goliath_api.project_cockpit(p_assignment_id,p_project_id);
    health:=cockpit->'health';
    v_project:=cockpit->'project';
    v_sources:=cockpit->'sources';
  ELSE
    SELECT jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'lifecycle',p.lifecycle,'baselineFinish',p.baseline_finish,'forecastFinish',p.forecast_finish)
      INTO v_project FROM public.pc_projects p WHERE p.id=p_project_id;
    health:=goliath_api.project_health_projection(p_assignment_id,p_project_id);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'type',s.source_type,'ref',s.source_ref,'status',s.status,'lastObservedAt',s.last_observed_at) ORDER BY s.id),'[]'::jsonb)
      INTO v_sources FROM public.pc_sources s WHERE s.project_id=p_project_id;
  END IF;

  SELECT max(last_observed_at) INTO v_data_as_of FROM public.pc_sources WHERE project_id=p_project_id;

  SELECT COALESCE(jsonb_agg(
    CASE WHEN p_audience='client' THEN
      jsonb_build_object('id',c.id,'type',c.type,'title',c.title,'committedDate',c.committed_date,'forecastDate',CASE WHEN c.client_visible_forecast=1 THEN c.forecast_date ELSE NULL END,'state',c.state)
    ELSE
      jsonb_build_object('id',c.id,'type',c.type,'title',c.title,'ownerId',c.accountable_owner_id,'committedDate',c.committed_date,'forecastDate',c.forecast_date,'state',c.state,'evidenceMaturity',c.evidence_maturity)
    END
    ORDER BY c.committed_date NULLS LAST,c.title
  ),'[]'::jsonb) INTO v_commitments
  FROM public.pc_commitments c
  WHERE c.project_id=p_project_id AND c.state NOT IN ('cancelled','closed');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',d.id,'question',d.question,'neededBy',d.needed_by,'state',d.state,
    'impactIfLate',CASE WHEN p_audience='client' THEN NULL ELSE d.impact_if_late END,
    'decisionOwnerId',CASE WHEN p_audience='client' THEN NULL ELSE d.decision_owner_id END
  ) ORDER BY d.needed_by NULLS LAST,d.created_at),'[]'::jsonb) INTO v_decisions
  FROM public.pc_decisions d
  WHERE d.project_id=p_project_id AND d.state='pending';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',dep.id,'consumerCommitmentId',dep.consumer_commitment_id,
    'neededBy',dep.needed_by,'promisedDate',dep.promised_date,'state',dep.state,
    'providerType',CASE WHEN p_audience='client' THEN NULL ELSE dep.provider_type END,
    'providerRef',CASE WHEN p_audience='client' THEN NULL ELSE dep.provider_ref END
  ) ORDER BY dep.needed_by,dep.id),'[]'::jsonb) INTO v_dependencies
  FROM public.pc_commitment_dependencies dep
  WHERE dep.project_id=p_project_id AND dep.state NOT IN ('accepted','cancelled');

  v_capabilities:=goliath_api.report_capability_catalog(p_assignment_id,p_project_id);

  RETURN jsonb_build_object(
    'reportType','weekly-status',
    'audience',p_audience,
    'period',jsonb_build_object('kind',p_period_kind,'start',p_period_start,'end',p_period_end),
    'generatedAt',now()::text,
    'dataAsOf',v_data_as_of,
    'project',v_project,
    'health',health,
    'sections',jsonb_build_object(
      'forAwareness',jsonb_build_object('commitments',v_commitments,'sourceStatus',v_sources),
      'forDiscussion',jsonb_build_object('dependencies',v_dependencies),
      'forDecision',jsonb_build_object('decisions',v_decisions),
      'forEscalation',jsonb_build_object(
        'blockedOrLikelyToMiss',COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(COALESCE(health->'commitments','[]'::jsonb)) x WHERE x->>'state' IN ('blocked','likely-to-miss','at-risk')),'[]'::jsonb),
        'overdueDecisions',COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_decisions) x WHERE x->>'neededBy' IS NOT NULL AND (x->>'neededBy')::date<current_date),'[]'::jsonb)
      )
    ),
    'traditionalReportAvailability',v_capabilities,
    'governance',jsonb_build_object('singleSourceProjection',true,'fabricatedMetrics',false,'externalHumanApprovalRequired',(p_audience='client'))
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.snapshot_project_report(
  p_assignment_id text,
  p_project_id text,
  p_audience text,
  p_period_kind text DEFAULT 'weekly',
  p_period_start text DEFAULT NULL,
  p_period_end text DEFAULT NULL,
  p_external_approval_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  ctx jsonb;
  projection jsonb;
  v_id text:='rpt-'||gen_random_uuid()::text;
  v_hash text;
  v_headline text;
  v_data_as_of text;
  v_approval_state text:='draft';
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','program-manager','pmo','sponsor') THEN
    RAISE EXCEPTION 'This responsibility cannot snapshot project reports.' USING ERRCODE='42501';
  END IF;
  IF p_audience='client' THEN
    IF ctx->>'role' NOT IN ('project-manager','project-director') THEN
      RAISE EXCEPTION 'Only the Project Manager or Project Director may approve an external client report.' USING ERRCODE='42501';
    END IF;
    IF COALESCE(length(trim(p_external_approval_reason)),0)<5 THEN
      RAISE EXCEPTION 'External client report requires an explicit human approval reason.' USING ERRCODE='22023';
    END IF;
    v_approval_state:='approved';
  END IF;

  projection:=goliath_api.project_report_preview(p_assignment_id,p_project_id,p_audience,p_period_kind,p_period_start,p_period_end);
  v_data_as_of:=projection->>'dataAsOf';
  v_headline:=COALESCE(projection#>>'{project,name}','Project')||' · '||COALESCE(projection#>>'{health,state}','data-insufficient');
  v_hash:=encode(digest(projection::text,'sha256'),'hex');

  INSERT INTO public.pc_report_snapshots(
    id,project_id,audience,generated_at,headline,projection_hash,projection_json,source_refs_json,
    report_type,period_kind,period_start,period_end,generated_by,approval_state,
    approved_by,approved_at,approval_reason,distribution_state,data_as_of,evidence_versions_json,revision
  ) VALUES(
    v_id,p_project_id,p_audience,now()::text,v_headline,v_hash,projection::text,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',s.id,'sourceRef',s.source_ref,'lastObservedAt',s.last_observed_at,'revision',s.revision) ORDER BY s.id)::text FROM public.pc_sources s WHERE s.project_id=p_project_id),'[]'),
    'weekly-status',p_period_kind,p_period_start,p_period_end,ctx->>'userId',v_approval_state,
    CASE WHEN v_approval_state='approved' THEN ctx->>'userId' ELSE NULL END,
    CASE WHEN v_approval_state='approved' THEN now()::text ELSE NULL END,
    NULLIF(trim(p_external_approval_reason),''),'not-distributed',v_data_as_of,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('commitmentId',c.id,'revision',c.revision) ORDER BY c.id)::text FROM public.pc_commitments c WHERE c.project_id=p_project_id),'[]'),1
  );

  PERFORM goliath_api.append_project_event(
    p_project_id,ctx->>'userId','report.snapshot.created','report-snapshot',v_id,'recorded',
    CASE WHEN p_audience='client' THEN trim(p_external_approval_reason) ELSE 'Governed report snapshot created.' END,
    NULL,1,jsonb_build_object('audience',p_audience,'periodKind',p_period_kind,'projectionHash',v_hash,'approvalState',v_approval_state)
  );

  RETURN jsonb_build_object('snapshotId',v_id,'projectId',p_project_id,'audience',p_audience,'projectionHash',v_hash,'approvalState',v_approval_state,'distributionState','not-distributed');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.report_snapshot_history(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN
    RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',r.id,'audience',r.audience,'reportType',r.report_type,'periodKind',r.period_kind,
    'periodStart',r.period_start,'periodEnd',r.period_end,'generatedAt',r.generated_at,
    'headline',r.headline,'projectionHash',r.projection_hash,'approvalState',r.approval_state,
    'distributionState',r.distribution_state,'dataAsOf',r.data_as_of,'revision',r.revision
  ) ORDER BY r.generated_at DESC) FROM public.pc_report_snapshots r WHERE r.project_id=p_project_id),'[]'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION goliath_api.report_capability_catalog(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.project_report_preview(text,text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.snapshot_project_report(text,text,text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.report_snapshot_history(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.report_capability_catalog(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.project_report_preview(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.snapshot_project_report(text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.report_snapshot_history(text,text) TO authenticated;

COMMIT;

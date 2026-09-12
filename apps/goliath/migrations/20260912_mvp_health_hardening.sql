-- Health hardening: source existence, partial visibility and derived-data classification.

BEGIN;

ALTER TABLE public.pc_health_policies
  ADD COLUMN IF NOT EXISTS working_day_calendar_mode text NOT NULL DEFAULT 'weekday-only-no-holidays';

CREATE OR REPLACE FUNCTION goliath_api.commitment_health_projection(
  p_assignment_id text,
  p_commitment_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  ctx jsonb;
  c public.pc_commitments%ROWTYPE;
  pol public.pc_health_policies%ROWTYPE;
  required_count integer:=0;
  covered_count integer:=0;
  coverage real;
  current_work integer:=0;
  total_work integer:=0;
  blocked_work integer:=0;
  done_work integer:=0;
  latest_work_forecast date;
  source_as_of text;
  schedule_state text:='data-insufficient';
  dependency_state text:='on-track';
  decision_state text:='on-track';
  delivery_state text:='data-insufficient';
  overall_state text;
  primary_cause text:='none';
  near_deadline date;
  dep_late integer:=0;
  dep_at_risk integer:=0;
  dep_unacked integer:=0;
  decision_overdue integer:=0;
  decision_soon integer:=0;
  dims jsonb;
  v_partial boolean:=false;
  v_highest_class text:='delivery';
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.pc_commitments WHERE id=p_commitment_id;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,c.project_id) THEN RAISE EXCEPTION 'Commitment is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  SELECT * INTO pol FROM public.pc_health_policies WHERE project_id=c.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Health policy is not configured for this project.' USING ERRCODE='22023'; END IF;

  near_deadline:=goliath_api.add_working_days(current_date,pol.near_deadline_working_days);
  BEGIN required_count:=jsonb_array_length(c.evidence_spec_json::jsonb); EXCEPTION WHEN others THEN required_count:=0; END;

  SELECT EXISTS(
    SELECT 1 FROM public.pc_evidence_links e
    WHERE e.commitment_id=c.id AND e.lifecycle_state='active'
      AND NOT goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')
  ) INTO v_partial;

  SELECT e.classification INTO v_highest_class
  FROM public.pc_evidence_links e
  WHERE e.commitment_id=c.id AND e.lifecycle_state='active'
    AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')
  ORDER BY goliath_api.data_class_rank(e.classification) DESC
  LIMIT 1;
  v_highest_class:=COALESCE(v_highest_class,'delivery');

  IF required_count>0 THEN
    SELECT count(DISTINCT e.evidence_kind)
    INTO covered_count
    FROM public.pc_evidence_links e
    WHERE e.commitment_id=c.id
      AND e.lifecycle_state='active'
      AND e.freshness_state='current'
      AND e.evidence_kind IN (SELECT jsonb_array_elements_text(c.evidence_spec_json::jsonb))
      AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read');
    coverage:=covered_count::real/required_count::real;
  ELSE coverage:=NULL; END IF;

  SELECT count(*) FILTER (WHERE a.id IS NOT NULL),
         count(*) FILTER (WHERE a.id IS NOT NULL AND e.freshness_state='current'),
         count(*) FILTER (WHERE a.id IS NOT NULL AND a.status='blocked' AND e.freshness_state='current'),
         count(*) FILTER (WHERE a.id IS NOT NULL AND a.status='done' AND e.freshness_state='current'),
         max(NULLIF(COALESCE(a.forecast_finish,a.baseline_finish),'')::date),
         max(COALESCE(e.source_updated_at,e.last_reconciled_at,e.ingested_at))
  INTO total_work,current_work,blocked_work,done_work,latest_work_forecast,source_as_of
  FROM public.pc_evidence_links e
  LEFT JOIN public.pc_activities a ON a.project_id=e.project_id AND a.id=e.source_object_id
  WHERE e.commitment_id=c.id AND e.evidence_kind='work' AND e.lifecycle_state='active'
    AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read');

  IF c.state IN ('accepted','waived','closed') THEN schedule_state:='on-track';
  ELSIF c.committed_date IS NULL OR current_work=0 THEN schedule_state:='data-insufficient';
  ELSIF NULLIF(c.committed_date,'')::date<current_date THEN schedule_state:='likely-to-miss';
  ELSIF COALESCE(NULLIF(c.forecast_date,'')::date,latest_work_forecast)>NULLIF(c.committed_date,'')::date THEN schedule_state:='at-risk';
  ELSIF NULLIF(c.committed_date,'')::date<=near_deadline AND done_work<current_work THEN schedule_state:='drifting';
  ELSE schedule_state:='on-track'; END IF;

  SELECT
    count(*) FILTER (WHERE d.state='late' OR (NULLIF(d.needed_by,'')::date<current_date AND d.state NOT IN ('accepted','cancelled'))),
    count(*) FILTER (WHERE d.state='at-risk' OR (d.promised_date IS NOT NULL AND NULLIF(d.promised_date,'')::date>NULLIF(d.needed_by,'')::date)),
    count(*) FILTER (WHERE (d.provider_acknowledged_at IS NULL OR d.consumer_acknowledged_at IS NULL) AND NULLIF(d.needed_by,'')::date<=near_deadline)
  INTO dep_late,dep_at_risk,dep_unacked
  FROM public.pc_commitment_dependencies d
  WHERE d.consumer_commitment_id=c.id AND d.state<>'cancelled';
  IF dep_late>0 THEN dependency_state:='blocked';
  ELSIF dep_at_risk>0 THEN dependency_state:='at-risk';
  ELSIF dep_unacked>0 THEN dependency_state:='drifting';
  ELSE dependency_state:='on-track'; END IF;

  SELECT
    count(*) FILTER (WHERE d.state='pending' AND d.needed_by IS NOT NULL AND NULLIF(d.needed_by,'')::date<current_date),
    count(*) FILTER (WHERE d.state='pending' AND d.needed_by IS NOT NULL AND NULLIF(d.needed_by,'')::date>=current_date AND NULLIF(d.needed_by,'')::date<=current_date+pol.decision_warning_days)
  INTO decision_overdue,decision_soon
  FROM public.pc_decisions d
  JOIN public.pc_decision_commitments dc ON dc.decision_id=d.id
  WHERE dc.commitment_id=c.id;
  IF decision_overdue>0 THEN decision_state:='at-risk';
  ELSIF decision_soon>0 THEN decision_state:='drifting';
  ELSE decision_state:='on-track'; END IF;

  IF coverage IS NULL OR coverage<pol.evidence_coverage_floor OR current_work=0 THEN delivery_state:='data-insufficient';
  ELSIF blocked_work>0 THEN delivery_state:='blocked';
  ELSE delivery_state:='on-track'; END IF;

  IF dependency_state='blocked' OR delivery_state='blocked' THEN overall_state:='blocked';
  ELSIF schedule_state='likely-to-miss' THEN overall_state:='likely-to-miss';
  ELSIF schedule_state='at-risk' OR dependency_state='at-risk' OR decision_state='at-risk' THEN overall_state:='at-risk';
  ELSIF (schedule_state='data-insufficient' OR delivery_state='data-insufficient') AND c.committed_date IS NOT NULL AND NULLIF(c.committed_date,'')::date<=near_deadline THEN overall_state:='at-risk';
  ELSIF schedule_state='drifting' OR dependency_state='drifting' OR decision_state='drifting' THEN overall_state:='drifting';
  ELSIF schedule_state='data-insufficient' OR delivery_state='data-insufficient' THEN overall_state:='data-insufficient';
  ELSE overall_state:='on-track'; END IF;

  primary_cause:=CASE
    WHEN overall_state IN ('blocked','at-risk','drifting') AND dependency_state IN ('blocked','at-risk','drifting') THEN 'external-dependency'
    WHEN overall_state IN ('blocked','at-risk','drifting') AND decision_state IN ('at-risk','drifting') THEN 'unresolved-decision'
    WHEN overall_state IN ('data-insufficient','at-risk') AND (schedule_state='data-insufficient' OR delivery_state='data-insufficient') THEN 'data-insufficient'
    WHEN overall_state IN ('at-risk','drifting','likely-to-miss','blocked') THEN 'execution-delay'
    ELSE 'none' END;

  dims:=jsonb_build_object(
    'schedule',jsonb_build_object('state',schedule_state,'committedDate',c.committed_date,'forecastDate',COALESCE(c.forecast_date,latest_work_forecast::text)),
    'dependencies',jsonb_build_object('state',dependency_state,'late',dep_late,'atRisk',dep_at_risk,'unacknowledgedNearNeedBy',dep_unacked),
    'decisions',jsonb_build_object('state',decision_state,'overdue',decision_overdue,'dueSoon',decision_soon),
    'deliveryProgress',jsonb_build_object('state',delivery_state,'currentWorkSignals',current_work,'blockedWorkSignals',blocked_work,'evidenceCoverage',coverage)
  );

  RETURN jsonb_build_object(
    'projectId',c.project_id,'commitmentId',c.id,'state',overall_state,'primaryCause',primary_cause,
    'dimensions',dims,'evidenceCoverage',coverage,'sourceAsOf',source_as_of,
    'partial',v_partial,'highestDataClass',v_highest_class,
    'shadowMode',pol.shadow_mode=1,'shadowUntil',pol.shadow_until,'policyVersion',pol.policy_version,
    'calendarMode',pol.working_day_calendar_mode,
    'engineVersion','mvp-health-v1.1','origin','system-computed'
  );
END $$;

CREATE OR REPLACE FUNCTION goliath_api.record_commitment_health(
  p_assignment_id text,
  p_commitment_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; h jsonb; v_id text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'This responsibility cannot persist a health snapshot.' USING ERRCODE='42501'; END IF;
  h:=goliath_api.commitment_health_projection(p_assignment_id,p_commitment_id);
  INSERT INTO public.pc_health_records(project_id,subject_type,subject_id,computed_at,overall_state,primary_cause,dimensions_json,evidence_refs_json,evidence_coverage,source_as_of,shadow_mode,policy_version,engine_version,highest_data_class)
  VALUES(h->>'projectId','commitment',h->>'commitmentId',now()::text,h->>'state',h->>'primaryCause',(h->'dimensions')::text,'[]',NULLIF(h->>'evidenceCoverage','')::real,h->>'sourceAsOf',CASE WHEN (h->>'shadowMode')::boolean THEN 1 ELSE 0 END,(h->>'policyVersion')::integer,h->>'engineVersion',h->>'highestDataClass') RETURNING id INTO v_id;
  PERFORM goliath_api.append_project_event(h->>'projectId',ctx->>'userId','health.snapshot.recorded','health',v_id,'recorded','Deterministic MVP health snapshot recorded.',NULL,1,jsonb_build_object('commitmentId',p_commitment_id,'state',h->>'state','shadowMode',h->>'shadowMode','highestDataClass',h->>'highestDataClass'));
  RETURN h||jsonb_build_object('healthRecordId',v_id);
END $$;

COMMIT;

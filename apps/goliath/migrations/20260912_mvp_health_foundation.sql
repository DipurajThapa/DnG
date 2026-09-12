-- Deterministic MVP health foundation.
-- Four dimensions only: schedule, dependencies, decisions, delivery progress.
-- No model-generated probability. New projects remain in shadow mode.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pc_health_policies (
  project_id text PRIMARY KEY REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  evidence_coverage_floor real NOT NULL DEFAULT 0.60 CHECK (evidence_coverage_floor BETWEEN 0 AND 1),
  near_deadline_working_days integer NOT NULL DEFAULT 10 CHECK (near_deadline_working_days BETWEEN 1 AND 60),
  decision_warning_days integer NOT NULL DEFAULT 5 CHECK (decision_warning_days BETWEEN 1 AND 60),
  shadow_mode integer NOT NULL DEFAULT 1 CHECK (shadow_mode IN (0,1)),
  shadow_until text,
  director_auto_escalation_enabled integer NOT NULL DEFAULT 0 CHECK (director_auto_escalation_enabled IN (0,1)),
  precision_gate real NOT NULL DEFAULT 0.50 CHECK (precision_gate BETWEEN 0 AND 1),
  minimum_resolved_warnings integer NOT NULL DEFAULT 30 CHECK (minimum_resolved_warnings >= 1),
  policy_version integer NOT NULL DEFAULT 1,
  updated_at text NOT NULL DEFAULT (now()::text),
  updated_by text NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS public.pc_health_records (
  id text PRIMARY KEY DEFAULT ('hlth-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('commitment','project')),
  subject_id text NOT NULL,
  computed_at text NOT NULL,
  overall_state text NOT NULL CHECK (overall_state IN ('on-track','drifting','at-risk','blocked','likely-to-miss','data-insufficient')),
  primary_cause text NOT NULL CHECK (primary_cause IN ('external-dependency','resource-unavailability','changed-requirements','unresolved-decision','technical-blocker','execution-delay','data-insufficient','none')),
  secondary_cause text,
  dimensions_json text NOT NULL,
  evidence_refs_json text NOT NULL DEFAULT '[]',
  evidence_coverage real,
  source_as_of text,
  shadow_mode integer NOT NULL CHECK (shadow_mode IN (0,1)),
  policy_version integer NOT NULL,
  engine_version text NOT NULL,
  highest_data_class text NOT NULL DEFAULT 'delivery' CHECK (highest_data_class IN ('delivery','financial-cost','financial-billing','hr','client-confidential','audit')),
  origin text NOT NULL DEFAULT 'system-computed' CHECK (origin IN ('system-computed'))
);

CREATE INDEX IF NOT EXISTS idx_pc_health_records_subject_time
  ON public.pc_health_records(project_id,subject_type,subject_id,computed_at DESC);

CREATE TABLE IF NOT EXISTS public.pc_pm_assessments (
  id text PRIMARY KEY DEFAULT ('pma-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  commitment_id text REFERENCES public.pc_commitments(id) ON DELETE CASCADE,
  assessor_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('on-track','drifting','at-risk','blocked','likely-to-miss','data-insufficient')),
  reason text NOT NULL,
  assessed_at text NOT NULL,
  source text NOT NULL DEFAULT 'human',
  revision integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pc_pm_assessments_project_time
  ON public.pc_pm_assessments(project_id,commitment_id,assessed_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_pc_health_records_no_update') THEN
    CREATE TRIGGER trg_pc_health_records_no_update BEFORE UPDATE ON public.pc_health_records FOR EACH ROW EXECUTE FUNCTION public.edapos_reject_mutation_on_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_pc_health_records_no_delete') THEN
    CREATE TRIGGER trg_pc_health_records_no_delete BEFORE DELETE ON public.pc_health_records FOR EACH ROW EXECUTE FUNCTION public.edapos_reject_mutation_on_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_pc_pm_assessments_no_update') THEN
    CREATE TRIGGER trg_pc_pm_assessments_no_update BEFORE UPDATE ON public.pc_pm_assessments FOR EACH ROW EXECUTE FUNCTION public.edapos_reject_mutation_on_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_pc_pm_assessments_no_delete') THEN
    CREATE TRIGGER trg_pc_pm_assessments_no_delete BEFORE DELETE ON public.pc_pm_assessments FOR EACH ROW EXECUTE FUNCTION public.edapos_reject_mutation_on_append_only();
  END IF;
END $$;

INSERT INTO public.pc_health_policies(project_id,shadow_until)
SELECT id,(current_date + interval '56 days')::date::text FROM public.pc_projects
ON CONFLICT (project_id) DO NOTHING;

CREATE OR REPLACE FUNCTION goliath_api.add_working_days(p_start date,p_days integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE d date:=p_start; added integer:=0;
BEGIN
  WHILE added<p_days LOOP
    d:=d+1;
    IF extract(isodow from d)<6 THEN added:=added+1; END IF;
  END LOOP;
  RETURN d;
END $$;

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
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.pc_commitments WHERE id=p_commitment_id;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,c.project_id) THEN RAISE EXCEPTION 'Commitment is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  SELECT * INTO pol FROM public.pc_health_policies WHERE project_id=c.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Health policy is not configured for this project.' USING ERRCODE='22023'; END IF;

  near_deadline:=goliath_api.add_working_days(current_date,pol.near_deadline_working_days);

  BEGIN required_count:=jsonb_array_length(c.evidence_spec_json::jsonb); EXCEPTION WHEN others THEN required_count:=0; END;
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

  SELECT count(*),
         count(*) FILTER (WHERE e.freshness_state='current'),
         count(*) FILTER (WHERE a.status='blocked' AND e.freshness_state='current'),
         count(*) FILTER (WHERE a.status='done' AND e.freshness_state='current'),
         max(NULLIF(COALESCE(a.forecast_finish,a.baseline_finish),'')::date),
         max(COALESCE(e.source_updated_at,e.last_reconciled_at,e.ingested_at))
  INTO total_work,current_work,blocked_work,done_work,latest_work_forecast,source_as_of
  FROM public.pc_evidence_links e
  LEFT JOIN public.pc_activities a ON a.project_id=e.project_id AND a.id=e.source_object_id
  WHERE e.commitment_id=c.id AND e.evidence_kind='work' AND e.lifecycle_state='active';

  IF c.state IN ('accepted','waived','closed') THEN schedule_state:='on-track';
  ELSIF c.committed_date IS NULL OR current_work=0 THEN schedule_state:='data-insufficient';
  ELSIF NULLIF(c.committed_date,'')::date<current_date THEN schedule_state:='likely-to-miss';
  ELSIF COALESCE(NULLIF(c.forecast_date,'')::date,latest_work_forecast)>NULLIF(c.committed_date,'')::date THEN schedule_state:='at-risk';
  ELSIF NULLIF(c.committed_date,'')::date<=near_deadline AND done_work<current_work THEN schedule_state:='drifting';
  ELSE schedule_state:='on-track'; END IF;

  SELECT
    count(*) FILTER (WHERE d.state IN ('late','cancelled') OR (d.needed_by<current_date::text AND d.state NOT IN ('accepted','cancelled'))),
    count(*) FILTER (WHERE d.state='at-risk' OR (d.promised_date IS NOT NULL AND d.promised_date>d.needed_by)),
    count(*) FILTER (WHERE (d.provider_acknowledged_at IS NULL OR d.consumer_acknowledged_at IS NULL) AND d.needed_by<=near_deadline::text)
  INTO dep_late,dep_at_risk,dep_unacked
  FROM public.pc_commitment_dependencies d
  WHERE d.consumer_commitment_id=c.id;
  IF dep_late>0 THEN dependency_state:='blocked';
  ELSIF dep_at_risk>0 THEN dependency_state:='at-risk';
  ELSIF dep_unacked>0 THEN dependency_state:='drifting';
  ELSE dependency_state:='on-track'; END IF;

  SELECT
    count(*) FILTER (WHERE d.state='pending' AND d.needed_by IS NOT NULL AND d.needed_by<current_date::text),
    count(*) FILTER (WHERE d.state='pending' AND d.needed_by IS NOT NULL AND d.needed_by>=current_date::text AND d.needed_by<=(current_date+pol.decision_warning_days)::text)
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
    'shadowMode',pol.shadow_mode=1,'shadowUntil',pol.shadow_until,'policyVersion',pol.policy_version,
    'engineVersion','mvp-health-v1','origin','system-computed'
  );
END $$;

CREATE OR REPLACE FUNCTION goliath_api.record_commitment_health(
  p_assignment_id text,
  p_commitment_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; h jsonb; v_id text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'This responsibility cannot persist a health snapshot.' USING ERRCODE='42501'; END IF;
  h:=goliath_api.commitment_health_projection(p_assignment_id,p_commitment_id);
  INSERT INTO public.pc_health_records(project_id,subject_type,subject_id,computed_at,overall_state,primary_cause,dimensions_json,evidence_refs_json,evidence_coverage,source_as_of,shadow_mode,policy_version,engine_version,highest_data_class)
  VALUES(h->>'projectId','commitment',h->>'commitmentId',now()::text,h->>'state',h->>'primaryCause',(h->'dimensions')::text,'[]',NULLIF(h->>'evidenceCoverage','')::real,h->>'sourceAsOf',CASE WHEN (h->>'shadowMode')::boolean THEN 1 ELSE 0 END,(h->>'policyVersion')::integer,h->>'engineVersion','delivery') RETURNING id INTO v_id;
  PERFORM goliath_api.append_project_event(h->>'projectId',ctx->>'userId','health.snapshot.recorded','health',v_id,'recorded','Deterministic MVP health snapshot recorded.',NULL,1,jsonb_build_object('commitmentId',p_commitment_id,'state',h->>'state','shadowMode',h->>'shadowMode'));
  RETURN h||jsonb_build_object('healthRecordId',v_id);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.record_pm_assessment(
  p_assignment_id text,
  p_project_id text,
  p_commitment_id text,
  p_state text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_id text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role'<>'project-manager' THEN RAISE EXCEPTION 'Project Manager responsibility required.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  IF p_state NOT IN ('on-track','drifting','at-risk','blocked','likely-to-miss','data-insufficient') THEN RAISE EXCEPTION 'Unsupported PM assessment state.' USING ERRCODE='22023'; END IF;
  IF length(trim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'PM assessment reason is required.' USING ERRCODE='22023'; END IF;
  IF p_commitment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pc_commitments WHERE id=p_commitment_id AND project_id=p_project_id) THEN RAISE EXCEPTION 'Commitment is not in the project.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.pc_pm_assessments(project_id,commitment_id,assessor_id,state,reason,assessed_at)
  VALUES(p_project_id,p_commitment_id,ctx->>'userId',p_state,trim(p_reason),now()::text) RETURNING id INTO v_id;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','health.pm-assessment.recorded','pm-assessment',v_id,'recorded',trim(p_reason),NULL,1,jsonb_build_object('commitmentId',p_commitment_id,'state',p_state));
  RETURN jsonb_build_object('assessmentId',v_id,'projectId',p_project_id,'commitmentId',p_commitment_id,'state',p_state);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.project_health_projection(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; rec record; rows jsonb:='[]'::jsonb; h jsonb; overall text:='data-insufficient'; worst_rank integer:=0; r integer; latest_pm jsonb;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  FOR rec IN SELECT id,title FROM public.pc_commitments WHERE project_id=p_project_id AND state NOT IN ('cancelled','closed') ORDER BY committed_date NULLS LAST,title LOOP
    h:=goliath_api.commitment_health_projection(p_assignment_id,rec.id);
    rows:=rows||jsonb_build_array(h||jsonb_build_object('title',rec.title));
    r:=CASE h->>'state' WHEN 'blocked' THEN 60 WHEN 'likely-to-miss' THEN 50 WHEN 'at-risk' THEN 40 WHEN 'drifting' THEN 30 WHEN 'data-insufficient' THEN 20 WHEN 'on-track' THEN 10 ELSE 0 END;
    IF r>worst_rank THEN worst_rank:=r; overall:=h->>'state'; END IF;
  END LOOP;
  SELECT jsonb_build_object('state',a.state,'reason',a.reason,'assessorId',a.assessor_id,'assessedAt',a.assessed_at)
  INTO latest_pm FROM public.pc_pm_assessments a WHERE a.project_id=p_project_id AND a.commitment_id IS NULL ORDER BY a.assessed_at DESC LIMIT 1;
  RETURN jsonb_build_object('projectId',p_project_id,'state',overall,'commitments',rows,'pmAssessment',latest_pm,'divergence',(latest_pm IS NOT NULL AND latest_pm->>'state'<>overall));
END $$;

REVOKE ALL ON TABLE public.pc_health_policies, public.pc_health_records, public.pc_pm_assessments FROM PUBLIC, anonymous, authenticated, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.commitment_health_projection(text,text), goliath_api.record_commitment_health(text,text), goliath_api.record_pm_assessment(text,text,text,text,text), goliath_api.project_health_projection(text,text) FROM PUBLIC, anonymous, goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.commitment_health_projection(text,text), goliath_api.record_commitment_health(text,text), goliath_api.record_pm_assessment(text,text,text,text,text), goliath_api.project_health_projection(text,text) TO authenticated;

COMMIT;

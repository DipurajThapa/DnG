-- Integrate first-class RAID into the governed reporting projection.
-- Client reports intentionally exclude internal RAID until explicit client-visible flags exist.
BEGIN;

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
  v_dated_activity_count integer;
  v_commitment_count integer;
  v_milestone_count integer;
  v_agile_stream_count integer;
  v_resource_count integer;
BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  SELECT count(*) FILTER (WHERE baseline_start IS NOT NULL AND baseline_finish IS NOT NULL) INTO v_dated_activity_count FROM public.pc_activities WHERE project_id=p_project_id;
  SELECT count(*),count(*) FILTER (WHERE type='milestone') INTO v_commitment_count,v_milestone_count FROM public.pc_commitments WHERE project_id=p_project_id AND state NOT IN ('cancelled','closed');
  SELECT count(*) INTO v_agile_stream_count FROM public.pc_workstreams WHERE project_id=p_project_id AND active=1 AND methodology IN ('agile','hybrid');
  SELECT count(DISTINCT r.id) INTO v_resource_count FROM public.rc_resources r JOIN public.rc_allocations a ON a.resource_id=r.id WHERE a.project_id=p_project_id AND a.planning_state<>'released';
  RETURN jsonb_build_array(
    jsonb_build_object('report','executive-status','available',true,'basis','Governed commitments, health, decisions, dependencies and RAID'),
    jsonb_build_object('report','milestone-status','available',(v_milestone_count>0 OR v_commitment_count>0),'basis','Confirmed commitments; imported milestones remain candidates until confirmed'),
    jsonb_build_object('report','gantt','available',(v_dated_activity_count>0),'basis',CASE WHEN v_dated_activity_count>0 THEN 'External/imported dated execution plan rendered as a view only' ELSE 'No dated source-plan rows' END),
    jsonb_build_object('report','burndown','available',false,'basis',CASE WHEN v_agile_stream_count=0 THEN 'No Agile/Hybrid workstream configured' ELSE 'Historical iteration/time-series scope and completion snapshots are not yet captured' END,'minimumData','Iteration boundaries plus historical scope/completion series'),
    jsonb_build_object('report','burnup','available',false,'basis',CASE WHEN v_agile_stream_count=0 THEN 'No Agile/Hybrid workstream configured' ELSE 'Historical scope and accepted-work series are not yet captured' END,'minimumData','Historical total-scope and accepted-work series'),
    jsonb_build_object('report','raid','available',true,'basis','First-class linked Risk/Issue/Assumption objects; client disclosure remains explicit/human-controlled'),
    jsonb_build_object('report','decision-log','available',true,'basis','Governed decision objects'),
    jsonb_build_object('report','dependency-log','available',true,'basis','Two-party commitment dependencies'),
    jsonb_build_object('report','capacity','available',(v_resource_count>0),'basis',CASE WHEN v_resource_count>0 THEN 'Governed resource allocations/capacity' ELSE 'No governed resource allocation data for this project' END)
  );
END
$$;

-- Wrapper projection lets callers add RAID without creating a competing report store.
CREATE OR REPLACE FUNCTION goliath_api.project_report_with_raid(
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
DECLARE base jsonb; raid jsonb;
BEGIN
  base:=goliath_api.project_report_preview(p_assignment_id,p_project_id,p_audience,p_period_kind,p_period_start,p_period_end);
  IF p_audience='client' THEN
    raid:=jsonb_build_object('items','[]'::jsonb,'triggerCandidates','[]'::jsonb,'disclosure','Internal RAID withheld until an authorised human selects client-visible items.');
  ELSE
    raid:=goliath_api.raid_board(p_assignment_id,p_project_id);
  END IF;
  RETURN jsonb_set(base,'{sections,forDiscussion,raid}',raid,true);
END
$$;

REVOKE ALL ON FUNCTION goliath_api.project_report_with_raid(text,text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.project_report_with_raid(text,text,text,text,text,text) TO authenticated;

COMMIT;

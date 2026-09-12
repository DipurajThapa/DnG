-- Goliath baseline + change control foundation
-- Date: 2026-09-12
-- Purpose: no silent baseline mutation. Material changes use the existing governed Decision model.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pc_baselines (
  id text PRIMARY KEY DEFAULT ('bl-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  label text NOT NULL,
  state text NOT NULL DEFAULT 'approved' CHECK (state IN ('approved','superseded')),
  source_type text NOT NULL CHECK (source_type IN ('initial','change-request','manual-migration')),
  source_ref text,
  approval_decision_id text REFERENCES public.pc_decisions(id),
  approved_by text NOT NULL,
  approved_at text NOT NULL,
  snapshot_json text NOT NULL,
  snapshot_hash text NOT NULL,
  created_at text NOT NULL,
  UNIQUE(project_id,version_no),
  UNIQUE(project_id,snapshot_hash)
);
CREATE INDEX IF NOT EXISTS idx_pc_baselines_project_state ON public.pc_baselines(project_id,state,version_no DESC);

CREATE TABLE IF NOT EXISTS public.pc_change_policies (
  project_id text PRIMARY KEY REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  self_approval_enabled integer NOT NULL DEFAULT 0 CHECK (self_approval_enabled IN (0,1)),
  self_approval_max_schedule_days integer,
  policy_note text NOT NULL DEFAULT 'No PM self-approval unless explicitly configured.',
  revision integer NOT NULL DEFAULT 1,
  updated_at text NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS public.pc_change_requests (
  id text PRIMARY KEY DEFAULT ('cr-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('manual','ticket','conversation','shadow-scope','client-request','risk','issue','other')),
  source_ref text,
  title text NOT NULL,
  description text NOT NULL,
  requester_id text NOT NULL,
  classification text CHECK (classification IN ('clarification','material-change')),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','clarified','pending-approval','approved','rejected','withdrawn','applied')),
  scope_impact text,
  schedule_impact_days integer,
  capacity_impact text,
  cost_impact_amount real,
  cost_impact_currency text,
  risk_impact text,
  dependency_impact text,
  impact_completeness text NOT NULL DEFAULT 'not-assessed' CHECK (impact_completeness IN ('not-assessed','partial','complete')),
  proposed_changes_json text NOT NULL DEFAULT '[]',
  approval_decision_id text REFERENCES public.pc_decisions(id),
  baseline_before_id text REFERENCES public.pc_baselines(id),
  baseline_after_id text REFERENCES public.pc_baselines(id),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  CHECK ((cost_impact_amount IS NULL AND cost_impact_currency IS NULL) OR (cost_impact_amount IS NOT NULL AND cost_impact_currency IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_pc_change_requests_project_state ON public.pc_change_requests(project_id,state,updated_at DESC);

CREATE TABLE IF NOT EXISTS public.pc_change_commitment_impacts (
  change_request_id text NOT NULL REFERENCES public.pc_change_requests(id) ON DELETE CASCADE,
  commitment_id text NOT NULL REFERENCES public.pc_commitments(id) ON DELETE CASCADE,
  proposed_committed_date text,
  proposed_acceptance_criteria text,
  impact_note text,
  PRIMARY KEY(change_request_id,commitment_id)
);

CREATE OR REPLACE FUNCTION goliath_api.current_baseline_snapshot_json(p_project_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
SELECT jsonb_build_object(
  'project',jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'lifecycle',p.lifecycle,'timezone',p.timezone),
  'workstreams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'methodology',w.methodology,'revision',w.revision) ORDER BY w.id) FROM public.pc_workstreams w WHERE w.project_id=p.id AND w.active=1),'[]'::jsonb),
  'commitments',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',c.id,'type',c.type,'title',c.title,'ownerId',c.accountable_owner_id,'committedDate',c.committed_date,
    'committedDateKind',c.committed_date_kind,'acceptanceCriteria',c.acceptance_criteria,'evidenceSpec',c.evidence_spec_json::jsonb,
    'state',c.state,'revision',c.revision
  ) ORDER BY c.id) FROM public.pc_commitments c WHERE c.project_id=p.id AND c.state NOT IN ('cancelled','closed')),'[]'::jsonb)
) FROM public.pc_projects p WHERE p.id=p_project_id;
$$;
REVOKE ALL ON FUNCTION goliath_api.current_baseline_snapshot_json(text) FROM PUBLIC,anonymous,goliath_web_anon,authenticated;

CREATE OR REPLACE FUNCTION goliath_api.record_baseline_snapshot(
  p_project_id text,
  p_source_type text,
  p_source_ref text,
  p_approval_decision_id text,
  p_approved_by text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','goliath_api'
AS $$
DECLARE snap jsonb; v_hash text; v_version integer; v_id text; old_id text;
BEGIN
  snap:=goliath_api.current_baseline_snapshot_json(p_project_id);
  IF snap IS NULL THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE='22023'; END IF;
  v_hash:=encode(digest(snap::text,'sha256'),'hex');
  SELECT id INTO old_id FROM public.pc_baselines WHERE project_id=p_project_id AND state='approved' ORDER BY version_no DESC LIMIT 1;
  IF old_id IS NOT NULL THEN UPDATE public.pc_baselines SET state='superseded' WHERE id=old_id; END IF;
  SELECT COALESCE(max(version_no),0)+1 INTO v_version FROM public.pc_baselines WHERE project_id=p_project_id;
  INSERT INTO public.pc_baselines(project_id,version_no,label,state,source_type,source_ref,approval_decision_id,approved_by,approved_at,snapshot_json,snapshot_hash,created_at)
  VALUES(p_project_id,v_version,'Baseline v'||v_version,'approved',p_source_type,p_source_ref,p_approval_decision_id,p_approved_by,now()::text,snap::text,v_hash,now()::text)
  RETURNING id INTO v_id;
  UPDATE public.pc_projects SET baseline_version='v'||v_version,baseline_accepted=1,updated_at=now()::text,revision=revision+1 WHERE id=p_project_id;
  RETURN v_id;
END
$$;
REVOKE ALL ON FUNCTION goliath_api.record_baseline_snapshot(text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon,authenticated;

CREATE OR REPLACE FUNCTION goliath_api.create_change_request(
  p_assignment_id text,
  p_project_id text,
  p_source_type text,
  p_source_ref text,
  p_title text,
  p_description text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_id text; base_id text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  IF p_source_type NOT IN ('manual','ticket','conversation','shadow-scope','client-request','risk','issue','other') THEN RAISE EXCEPTION 'Unsupported change source.' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(trim(p_title)),0)<3 OR COALESCE(length(trim(p_description)),0)<5 THEN RAISE EXCEPTION 'Meaningful change title and description are required.' USING ERRCODE='22023'; END IF;
  SELECT id INTO base_id FROM public.pc_baselines WHERE project_id=p_project_id AND state='approved' ORDER BY version_no DESC LIMIT 1;
  INSERT INTO public.pc_change_requests(project_id,source_type,source_ref,title,description,requester_id,state,baseline_before_id,created_at,updated_at)
  VALUES(p_project_id,p_source_type,NULLIF(trim(p_source_ref),''),trim(p_title),trim(p_description),ctx->>'userId','draft',base_id,now()::text,now()::text)
  RETURNING id INTO v_id;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','change.created','change-request',v_id,'recorded','Change request raised from source; classification and impact remain human-controlled.',NULL,1,jsonb_build_object('sourceType',p_source_type,'sourceRef',p_source_ref));
  RETURN jsonb_build_object('changeRequestId',v_id,'state','draft','baselineBeforeId',base_id);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.prepare_change_request(
  p_assignment_id text,
  p_change_request_id text,
  p_classification text,
  p_scope_impact text,
  p_schedule_impact_days integer,
  p_capacity_impact text,
  p_cost_impact_amount real,
  p_cost_impact_currency text,
  p_risk_impact text,
  p_dependency_impact text,
  p_impact_completeness text,
  p_approver_user_id text,
  p_commitment_changes jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; cr public.pc_change_requests%ROWTYPE; v_role text; v_decision jsonb; x jsonb; c_id text; v_links jsonb:='[]'::jsonb;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id); v_role:=ctx->>'role';
  IF v_role NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'Management responsibility is required to classify and prepare a change.' USING ERRCODE='42501'; END IF;
  SELECT * INTO cr FROM public.pc_change_requests WHERE id=p_change_request_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,cr.project_id) THEN RAISE EXCEPTION 'Change request is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF cr.state NOT IN ('draft','clarified') THEN RAISE EXCEPTION 'Only a draft/clarified change may be prepared.' USING ERRCODE='22023'; END IF;
  IF p_classification NOT IN ('clarification','material-change') THEN RAISE EXCEPTION 'Change classification must be clarification or material-change.' USING ERRCODE='22023'; END IF;
  IF p_impact_completeness NOT IN ('partial','complete') THEN RAISE EXCEPTION 'Impact assessment must be marked partial or complete.' USING ERRCODE='22023'; END IF;
  IF p_cost_impact_amount IS NOT NULL AND NOT goliath_api.context_has_data_class(p_assignment_id,'financial-cost','write') THEN RAISE EXCEPTION 'Financial-cost authority is required to record cost impact.' USING ERRCODE='42501'; END IF;

  DELETE FROM public.pc_change_commitment_impacts WHERE change_request_id=cr.id;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_commitment_changes,'[]'::jsonb)) LOOP
    c_id:=x->>'commitmentId';
    IF NOT EXISTS(SELECT 1 FROM public.pc_commitments WHERE id=c_id AND project_id=cr.project_id) THEN RAISE EXCEPTION 'Impacted commitment % is outside the change project.',c_id USING ERRCODE='22023'; END IF;
    INSERT INTO public.pc_change_commitment_impacts(change_request_id,commitment_id,proposed_committed_date,proposed_acceptance_criteria,impact_note)
    VALUES(cr.id,c_id,NULLIF(x->>'proposedCommittedDate',''),NULLIF(x->>'proposedAcceptanceCriteria',''),NULLIF(x->>'impactNote',''));
    v_links:=v_links||jsonb_build_array(c_id);
  END LOOP;

  UPDATE public.pc_change_requests SET classification=p_classification,scope_impact=NULLIF(trim(p_scope_impact),''),schedule_impact_days=p_schedule_impact_days,capacity_impact=NULLIF(trim(p_capacity_impact),''),cost_impact_amount=p_cost_impact_amount,cost_impact_currency=CASE WHEN p_cost_impact_amount IS NULL THEN NULL ELSE p_cost_impact_currency END,risk_impact=NULLIF(trim(p_risk_impact),''),dependency_impact=NULLIF(trim(p_dependency_impact),''),impact_completeness=p_impact_completeness,proposed_changes_json=COALESCE(p_commitment_changes,'[]'::jsonb)::text,updated_at=now()::text,revision=revision+1 WHERE id=cr.id;

  IF p_classification='clarification' THEN
    UPDATE public.pc_change_requests SET state='clarified' WHERE id=cr.id;
    PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','change.classified.clarification','change-request',cr.id,'recorded','Human classified request as clarification; baseline unchanged.',cr.revision,cr.revision+1,jsonb_build_object('impactCompleteness',p_impact_completeness));
    RETURN jsonb_build_object('changeRequestId',cr.id,'state','clarified','baselineChanged',false);
  END IF;

  IF p_approver_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.pc_project_members WHERE project_id=cr.project_id AND user_id=p_approver_user_id AND active=1) THEN RAISE EXCEPTION 'A governed project member must be the change approver.' USING ERRCODE='22023'; END IF;
  IF p_approver_user_id=cr.requester_id THEN
    IF NOT EXISTS(SELECT 1 FROM public.pc_change_policies pol WHERE pol.project_id=cr.project_id AND pol.self_approval_enabled=1 AND pol.self_approval_max_schedule_days IS NOT NULL AND abs(COALESCE(p_schedule_impact_days,0))<=pol.self_approval_max_schedule_days) THEN RAISE EXCEPTION 'Requester cannot approve this material change under the current project policy.' USING ERRCODE='42501'; END IF;
  END IF;

  v_decision:=goliath_api.create_decision(p_assignment_id,cr.project_id,'Approve material change '||cr.id||': '||cr.title,p_approver_user_id,(current_date+5)::text,'If late, work may wait or continue outside the approved baseline.',4,jsonb_build_array('approve','reject','request-rework'),'Review the assembled impact and decide.','human',v_links);
  UPDATE public.pc_change_requests SET state='pending-approval',approval_decision_id=v_decision->>'decisionId',updated_at=now()::text,revision=revision+1 WHERE id=cr.id;
  PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','change.submitted','change-request',cr.id,'recorded','Material change routed into the governed Decision queue.',cr.revision,cr.revision+2,jsonb_build_object('decisionId',v_decision->>'decisionId','approverUserId',p_approver_user_id,'impactCompleteness',p_impact_completeness));
  RETURN jsonb_build_object('changeRequestId',cr.id,'state','pending-approval','approvalDecisionId',v_decision->>'decisionId');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.finalize_change_request(
  p_assignment_id text,
  p_change_request_id text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; cr public.pc_change_requests%ROWTYPE; d public.pc_decisions%ROWTYPE; x public.pc_change_commitment_impacts%ROWTYPE; base_id text; before_rev integer;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'Management responsibility required to finalise change control.' USING ERRCODE='42501'; END IF;
  SELECT * INTO cr FROM public.pc_change_requests WHERE id=p_change_request_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,cr.project_id) THEN RAISE EXCEPTION 'Change request is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF cr.state<>'pending-approval' OR cr.approval_decision_id IS NULL THEN RAISE EXCEPTION 'Change request is not awaiting an approval decision.' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM public.pc_decisions WHERE id=cr.approval_decision_id;
  IF d.state='pending' THEN RAISE EXCEPTION 'Approval decision is still pending.' USING ERRCODE='22023'; END IF;
  IF d.state IN ('rejected','superseded') THEN
    UPDATE public.pc_change_requests SET state='rejected',updated_at=now()::text,revision=revision+1 WHERE id=cr.id;
    PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','change.rejected','change-request',cr.id,'recorded',COALESCE(NULLIF(trim(p_reason),''),d.reason),cr.revision,cr.revision+1,jsonb_build_object('decisionId',d.id));
    RETURN jsonb_build_object('changeRequestId',cr.id,'state','rejected','baselineChanged',false);
  END IF;
  IF d.state NOT IN ('approved','selected') THEN RAISE EXCEPTION 'Approval decision does not permit the change.' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(trim(p_reason)),0)<5 THEN RAISE EXCEPTION 'Finalisation reason is required.' USING ERRCODE='22023'; END IF;

  FOR x IN SELECT * FROM public.pc_change_commitment_impacts WHERE change_request_id=cr.id LOOP
    SELECT revision INTO before_rev FROM public.pc_commitments WHERE id=x.commitment_id;
    UPDATE public.pc_commitments SET
      committed_date=COALESCE(x.proposed_committed_date,committed_date),
      acceptance_criteria=COALESCE(x.proposed_acceptance_criteria,acceptance_criteria),
      updated_at=now()::text,revision=revision+1
    WHERE id=x.commitment_id;
    PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','commitment.rebaselined','commitment',x.commitment_id,'recorded',trim(p_reason),before_rev,before_rev+1,jsonb_build_object('changeRequestId',cr.id,'proposedCommittedDate',x.proposed_committed_date));
  END LOOP;

  base_id:=goliath_api.record_baseline_snapshot(cr.project_id,'change-request',cr.id,d.id,d.decided_by);
  UPDATE public.pc_change_requests SET state='applied',baseline_after_id=base_id,updated_at=now()::text,revision=revision+1 WHERE id=cr.id;
  PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','change.applied','change-request',cr.id,'recorded',trim(p_reason),cr.revision,cr.revision+1,jsonb_build_object('decisionId',d.id,'newBaselineId',base_id));
  RETURN jsonb_build_object('changeRequestId',cr.id,'state','applied','baselineChanged',true,'baselineAfterId',base_id);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.change_desk(p_assignment_id text,p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'currentBaseline',(SELECT jsonb_build_object('id',b.id,'version',b.version_no,'label',b.label,'approvedBy',b.approved_by,'approvedAt',b.approved_at,'hash',b.snapshot_hash) FROM public.pc_baselines b WHERE b.project_id=p_project_id AND b.state='approved' ORDER BY b.version_no DESC LIMIT 1),
    'changes',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',cr.id,'sourceType',cr.source_type,'sourceRef',cr.source_ref,'title',cr.title,'description',cr.description,
      'requesterId',cr.requester_id,'classification',cr.classification,'state',cr.state,'scopeImpact',cr.scope_impact,
      'scheduleImpactDays',cr.schedule_impact_days,'capacityImpact',cr.capacity_impact,
      'costImpact',CASE WHEN goliath_api.context_has_data_class(p_assignment_id,'financial-cost','read') AND cr.cost_impact_amount IS NOT NULL THEN jsonb_build_object('amount',cr.cost_impact_amount,'currency',cr.cost_impact_currency) ELSE NULL END,
      'riskImpact',cr.risk_impact,'dependencyImpact',cr.dependency_impact,'impactCompleteness',cr.impact_completeness,
      'approvalDecisionId',cr.approval_decision_id,'baselineBeforeId',cr.baseline_before_id,'baselineAfterId',cr.baseline_after_id,
      'createdAt',cr.created_at,'updatedAt',cr.updated_at,'revision',cr.revision
    ) ORDER BY cr.updated_at DESC) FROM public.pc_change_requests cr WHERE cr.project_id=p_project_id),'[]'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION goliath_api.create_change_request(text,text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.prepare_change_request(text,text,text,text,integer,text,real,text,text,text,text,text,jsonb) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.finalize_change_request(text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.change_desk(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.create_change_request(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.prepare_change_request(text,text,text,text,integer,text,real,text,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.finalize_change_request(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.change_desk(text,text) TO authenticated;

COMMIT;

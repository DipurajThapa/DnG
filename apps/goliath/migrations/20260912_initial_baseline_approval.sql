-- Initial baseline approval workflow
-- A baseline is not accepted merely because records exist; a named human decision approves it.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pc_baseline_approval_requests (
  id text PRIMARY KEY DEFAULT ('bar-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  decision_id text NOT NULL REFERENCES public.pc_decisions(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','applied','cancelled')),
  requested_by text NOT NULL,
  requested_at text NOT NULL,
  baseline_id text REFERENCES public.pc_baselines(id),
  finalized_by text,
  finalized_at text,
  UNIQUE(project_id,state) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE OR REPLACE FUNCTION goliath_api.submit_initial_baseline(
  p_assignment_id text,
  p_project_id text,
  p_approver_user_id text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_decision jsonb; v_request text; v_links jsonb;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'Project baseline preparation authority required.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.pc_baselines WHERE project_id=p_project_id AND state='approved') THEN RAISE EXCEPTION 'An approved baseline already exists; use change control.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.pc_baseline_approval_requests WHERE project_id=p_project_id AND state='pending') THEN RAISE EXCEPTION 'An initial baseline approval is already pending.' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(trim(p_reason)),0)<5 THEN RAISE EXCEPTION 'Baseline submission rationale is required.' USING ERRCODE='22023'; END IF;
  IF p_approver_user_id=ctx->>'userId' THEN RAISE EXCEPTION 'Initial baseline approver must be a different named human.' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pc_project_members WHERE project_id=p_project_id AND user_id=p_approver_user_id AND active=1) THEN RAISE EXCEPTION 'Approver must be an active governed project member.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pc_commitments WHERE project_id=p_project_id AND state IN ('planned','active','ready-for-acceptance')) THEN RAISE EXCEPTION 'At least one governed commitment is required before baseline approval.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.pc_commitments WHERE project_id=p_project_id AND state IN ('planned','active','ready-for-acceptance') AND (accountable_owner_id IS NULL OR committed_date IS NULL OR acceptance_criteria IS NULL OR jsonb_array_length(evidence_spec_json::jsonb)=0)) THEN RAISE EXCEPTION 'Every in-scope commitment needs owner, committed date, acceptance criteria and evidence specification before baselining.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.pc_requirements WHERE project_id=p_project_id AND state='proposed') THEN RAISE EXCEPTION 'Proposed requirements remain unresolved. Baseline or reject them before project baseline approval.' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO v_links FROM public.pc_commitments WHERE project_id=p_project_id AND state IN ('planned','active','ready-for-acceptance');
  v_decision:=goliath_api.create_decision(p_assignment_id,p_project_id,'Approve initial governed project baseline',p_approver_user_id,(current_date+5)::text,'Delivery should not proceed against an unapproved baseline.',5,jsonb_build_array('approve','reject','request-rework'),'Review commitments, requirements, acceptance criteria and evidence specifications.','human',v_links);
  INSERT INTO public.pc_baseline_approval_requests(project_id,decision_id,state,requested_by,requested_at) VALUES(p_project_id,v_decision->>'decisionId','pending',ctx->>'userId',now()::text) RETURNING id INTO v_request;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','baseline.approval.requested','baseline-approval',v_request,'recorded',trim(p_reason),NULL,1,jsonb_build_object('decisionId',v_decision->>'decisionId','approverUserId',p_approver_user_id));
  RETURN jsonb_build_object('requestId',v_request,'decisionId',v_decision->>'decisionId','state','pending');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.finalize_initial_baseline(
  p_assignment_id text,
  p_project_id text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; req public.pc_baseline_approval_requests%ROWTYPE; d public.pc_decisions%ROWTYPE; base_id text; choice text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'Project baseline finalisation authority required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO req FROM public.pc_baseline_approval_requests WHERE project_id=p_project_id AND state='pending' FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'No pending baseline approval is available.' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.pc_decisions WHERE id=req.decision_id;
  IF d.state='pending' THEN RAISE EXCEPTION 'Baseline approval decision is still pending.' USING ERRCODE='22023'; END IF;
  choice:=lower(trim(COALESCE(d.choice,'')));
  IF d.state='rejected' OR (d.state='selected' AND choice IN ('reject','rejected')) THEN
    UPDATE public.pc_baseline_approval_requests SET state='rejected',finalized_by=ctx->>'userId',finalized_at=now()::text WHERE id=req.id;
    RETURN jsonb_build_object('requestId',req.id,'state','rejected','baselineCreated',false);
  END IF;
  IF d.state='selected' AND choice IN ('request-rework','rework','request changes','request-changes') THEN
    UPDATE public.pc_baseline_approval_requests SET state='cancelled',finalized_by=ctx->>'userId',finalized_at=now()::text WHERE id=req.id;
    RETURN jsonb_build_object('requestId',req.id,'state','cancelled','reworkRequired',true,'baselineCreated',false);
  END IF;
  IF NOT (d.state='approved' OR (d.state='selected' AND choice IN ('approve','approved'))) THEN RAISE EXCEPTION 'Decision does not explicitly approve the baseline.' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(trim(p_reason)),0)<5 THEN RAISE EXCEPTION 'Baseline finalisation rationale is required.' USING ERRCODE='22023'; END IF;
  base_id:=goliath_api.record_baseline_snapshot(p_project_id,'initial',req.id,d.id,d.decided_by);
  UPDATE public.pc_baseline_approval_requests SET state='applied',baseline_id=base_id,finalized_by=ctx->>'userId',finalized_at=now()::text WHERE id=req.id;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','baseline.initial.applied','baseline',base_id,'recorded',trim(p_reason),NULL,1,jsonb_build_object('approvalDecisionId',d.id,'approvalRequestId',req.id));
  RETURN jsonb_build_object('requestId',req.id,'state','applied','baselineCreated',true,'baselineId',base_id);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.baseline_status(p_assignment_id text,p_project_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'current',(SELECT jsonb_build_object('id',b.id,'version',b.version_no,'label',b.label,'sourceType',b.source_type,'sourceRef',b.source_ref,'approvedBy',b.approved_by,'approvedAt',b.approved_at,'hash',b.snapshot_hash) FROM public.pc_baselines b WHERE b.project_id=p_project_id AND b.state='approved' ORDER BY b.version_no DESC LIMIT 1),
    'pendingApproval',(SELECT jsonb_build_object('id',r.id,'decisionId',r.decision_id,'requestedBy',r.requested_by,'requestedAt',r.requested_at) FROM public.pc_baseline_approval_requests r WHERE r.project_id=p_project_id AND r.state='pending' LIMIT 1)
  );
END
$$;

REVOKE ALL ON FUNCTION goliath_api.submit_initial_baseline(text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.finalize_initial_baseline(text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.baseline_status(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.submit_initial_baseline(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.finalize_initial_baseline(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.baseline_status(text,text) TO authenticated;

COMMIT;

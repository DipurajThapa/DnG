-- Change-control hardening: explicit approval semantics and real baseline delta required.
BEGIN;
CREATE OR REPLACE FUNCTION goliath_api.finalize_change_request(
  p_assignment_id text,
  p_change_request_id text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; cr public.pc_change_requests%ROWTYPE; d public.pc_decisions%ROWTYPE; x public.pc_change_commitment_impacts%ROWTYPE; base_id text; before_rev integer; v_choice text; v_has_delta boolean;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'Management responsibility required to finalise change control.' USING ERRCODE='42501'; END IF;
  SELECT * INTO cr FROM public.pc_change_requests WHERE id=p_change_request_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,cr.project_id) THEN RAISE EXCEPTION 'Change request is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF cr.state<>'pending-approval' OR cr.approval_decision_id IS NULL THEN RAISE EXCEPTION 'Change request is not awaiting an approval decision.' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM public.pc_decisions WHERE id=cr.approval_decision_id;
  IF d.state='pending' THEN RAISE EXCEPTION 'Approval decision is still pending.' USING ERRCODE='22023'; END IF;
  v_choice:=lower(trim(COALESCE(d.choice,'')));

  IF d.state='rejected' OR (d.state='selected' AND v_choice IN ('reject','rejected')) THEN
    UPDATE public.pc_change_requests SET state='rejected',updated_at=now()::text,revision=revision+1 WHERE id=cr.id;
    PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','change.rejected','change-request',cr.id,'recorded',COALESCE(NULLIF(trim(p_reason),''),d.reason),cr.revision,cr.revision+1,jsonb_build_object('decisionId',d.id,'decisionChoice',d.choice));
    RETURN jsonb_build_object('changeRequestId',cr.id,'state','rejected','baselineChanged',false);
  END IF;

  IF d.state='selected' AND v_choice IN ('request-rework','rework','request changes','request-changes') THEN
    UPDATE public.pc_change_requests SET state='draft',updated_at=now()::text,revision=revision+1 WHERE id=cr.id;
    PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','change.rework.requested','change-request',cr.id,'recorded',COALESCE(NULLIF(trim(p_reason),''),d.reason),cr.revision,cr.revision+1,jsonb_build_object('decisionId',d.id));
    RETURN jsonb_build_object('changeRequestId',cr.id,'state','draft','reworkRequired',true,'baselineChanged',false);
  END IF;

  IF NOT (d.state='approved' OR (d.state='selected' AND v_choice IN ('approve','approved'))) THEN
    RAISE EXCEPTION 'Approval decision does not explicitly approve this change.' USING ERRCODE='22023';
  END IF;
  IF COALESCE(length(trim(p_reason)),0)<5 THEN RAISE EXCEPTION 'Finalisation reason is required.' USING ERRCODE='22023'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.pc_change_commitment_impacts i
    JOIN public.pc_commitments c ON c.id=i.commitment_id
    WHERE i.change_request_id=cr.id
      AND ((i.proposed_committed_date IS NOT NULL AND i.proposed_committed_date IS DISTINCT FROM c.committed_date)
        OR (i.proposed_acceptance_criteria IS NOT NULL AND i.proposed_acceptance_criteria IS DISTINCT FROM c.acceptance_criteria))
  ) INTO v_has_delta;
  IF NOT v_has_delta THEN
    RAISE EXCEPTION 'The approved change has no baseline-affecting commitment delta supported by the current MVP. Do not create an empty baseline version.' USING ERRCODE='22023';
  END IF;

  FOR x IN SELECT * FROM public.pc_change_commitment_impacts WHERE change_request_id=cr.id LOOP
    SELECT revision INTO before_rev FROM public.pc_commitments WHERE id=x.commitment_id;
    UPDATE public.pc_commitments SET committed_date=COALESCE(x.proposed_committed_date,committed_date),acceptance_criteria=COALESCE(x.proposed_acceptance_criteria,acceptance_criteria),updated_at=now()::text,revision=revision+1
    WHERE id=x.commitment_id
      AND ((x.proposed_committed_date IS NOT NULL AND x.proposed_committed_date IS DISTINCT FROM committed_date)
        OR (x.proposed_acceptance_criteria IS NOT NULL AND x.proposed_acceptance_criteria IS DISTINCT FROM acceptance_criteria));
    IF FOUND THEN
      PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','commitment.rebaselined','commitment',x.commitment_id,'recorded',trim(p_reason),before_rev,before_rev+1,jsonb_build_object('changeRequestId',cr.id,'proposedCommittedDate',x.proposed_committed_date));
    END IF;
  END LOOP;

  base_id:=goliath_api.record_baseline_snapshot(cr.project_id,'change-request',cr.id,d.id,d.decided_by);
  UPDATE public.pc_change_requests SET state='applied',baseline_after_id=base_id,updated_at=now()::text,revision=revision+1 WHERE id=cr.id;
  PERFORM goliath_api.append_project_event(cr.project_id,ctx->>'userId','change.applied','change-request',cr.id,'recorded',trim(p_reason),cr.revision,cr.revision+1,jsonb_build_object('decisionId',d.id,'newBaselineId',base_id));
  RETURN jsonb_build_object('changeRequestId',cr.id,'state','applied','baselineChanged',true,'baselineAfterId',base_id);
END
$$;
COMMIT;

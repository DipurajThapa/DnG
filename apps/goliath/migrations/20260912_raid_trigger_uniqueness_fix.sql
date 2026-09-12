-- Harden RAID trigger event uniqueness for trigger types without an external reference.
BEGIN;
UPDATE public.pc_raid_trigger_events SET trigger_ref='' WHERE trigger_ref IS NULL;
ALTER TABLE public.pc_raid_trigger_events ALTER COLUMN trigger_ref SET DEFAULT '';
ALTER TABLE public.pc_raid_trigger_events ALTER COLUMN trigger_ref SET NOT NULL;

CREATE OR REPLACE FUNCTION goliath_api.evaluate_raid_triggers(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_role text; r record; v_fired integer:=0; v_evidence jsonb;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id); v_role:=ctx->>'role';
  IF v_role NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'This responsibility cannot evaluate watched RAID triggers.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT * FROM public.pc_raid_items WHERE project_id=p_project_id AND item_type IN ('risk','assumption') AND state IN ('open','monitoring','responding') AND trigger_type IS NOT NULL LOOP
    v_evidence:=NULL;
    IF r.trigger_type='dependency-late' AND EXISTS(SELECT 1 FROM public.pc_commitment_dependencies d WHERE d.id=r.trigger_ref AND d.project_id=p_project_id AND (d.state='late' OR (d.needed_by::date<current_date AND d.state NOT IN ('accepted','cancelled')))) THEN
      SELECT jsonb_build_object('dependencyId',d.id,'state',d.state,'neededBy',d.needed_by,'promisedDate',d.promised_date) INTO v_evidence FROM public.pc_commitment_dependencies d WHERE d.id=r.trigger_ref;
    ELSIF r.trigger_type='decision-overdue' AND EXISTS(SELECT 1 FROM public.pc_decisions d WHERE d.id=r.trigger_ref AND d.project_id=p_project_id AND d.state='pending' AND d.needed_by IS NOT NULL AND d.needed_by::date<current_date) THEN
      SELECT jsonb_build_object('decisionId',d.id,'neededBy',d.needed_by,'state',d.state) INTO v_evidence FROM public.pc_decisions d WHERE d.id=r.trigger_ref;
    ELSIF r.trigger_type='assumption-validation-date' AND r.item_type='assumption' AND r.validation_date::date<current_date AND COALESCE(jsonb_array_length(r.validation_evidence_refs_json::jsonb),0)=0 THEN
      v_evidence:=jsonb_build_object('validationDate',r.validation_date,'evidenceCount',0);
    END IF;
    IF v_evidence IS NOT NULL THEN
      INSERT INTO public.pc_raid_trigger_events(raid_id,project_id,observed_at,trigger_type,trigger_ref,evidence_json,state)
      VALUES(r.id,p_project_id,now()::text,r.trigger_type,COALESCE(r.trigger_ref,''),v_evidence::text,'candidate')
      ON CONFLICT (raid_id,trigger_type,trigger_ref,state) DO NOTHING;
      IF FOUND THEN v_fired:=v_fired+1; END IF;
    END IF;
  END LOOP;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','raid.triggers.evaluated','raid-trigger-run',gen_random_uuid()::text,'recorded','Deterministic RAID watched triggers evaluated.',NULL,NULL,jsonb_build_object('candidateCount',v_fired));
  RETURN jsonb_build_object('projectId',p_project_id,'newIssueCandidates',v_fired);
END
$$;
COMMIT;

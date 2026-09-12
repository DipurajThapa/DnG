-- Commitment readiness controls.
-- A planned commitment cannot become active until its control perimeter is complete.

BEGIN;

CREATE OR REPLACE FUNCTION goliath_api.set_commitment_evidence_spec(
  p_assignment_id text,
  p_commitment_id text,
  p_evidence_spec jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  ctx jsonb;
  c public.pc_commitments%ROWTYPE;
  v_kind text;
  v_before integer;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority is required.' USING ERRCODE='42501'; END IF;
  IF ctx->>'role' NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'This responsibility cannot set a commitment evidence specification.' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.pc_commitments WHERE id=p_commitment_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,c.project_id) THEN RAISE EXCEPTION 'Commitment is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(COALESCE(p_evidence_spec,'null'::jsonb))<>'array' OR jsonb_array_length(p_evidence_spec)=0 THEN RAISE EXCEPTION 'Evidence specification must be a non-empty array of required signal classes.' USING ERRCODE='22023'; END IF;
  FOR v_kind IN SELECT jsonb_array_elements_text(p_evidence_spec) LOOP
    IF v_kind NOT IN ('work','test','acceptance','document','approval','deployment','financial','decision','dependency','other') THEN RAISE EXCEPTION 'Unsupported evidence kind: %',v_kind USING ERRCODE='22023'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements_text(p_evidence_spec)) <> (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_evidence_spec) x) THEN RAISE EXCEPTION 'Evidence specification cannot contain duplicate signal classes.' USING ERRCODE='22023'; END IF;
  IF length(trim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Reason for evidence-spec change is required.' USING ERRCODE='22023'; END IF;
  v_before:=c.revision;
  UPDATE public.pc_commitments SET evidence_spec_json=p_evidence_spec::text,updated_at=now()::text,revision=revision+1 WHERE id=c.id;
  PERFORM goliath_api.append_project_event(c.project_id,ctx->>'userId','commitment.evidence-spec.updated','commitment',c.id,'recorded',trim(p_reason),v_before,v_before+1,jsonb_build_object('evidenceSpec',p_evidence_spec));
  RETURN jsonb_build_object('commitmentId',c.id,'evidenceSpec',p_evidence_spec,'revision',v_before+1);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.activate_commitment(
  p_assignment_id text,
  p_commitment_id text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  ctx jsonb;
  c public.pc_commitments%ROWTYPE;
  w public.pc_workstreams%ROWTYPE;
  v_before integer;
  v_spec jsonb;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority is required.' USING ERRCODE='42501'; END IF;
  IF ctx->>'role' NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'This responsibility cannot activate a commitment.' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.pc_commitments WHERE id=p_commitment_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,c.project_id) THEN RAISE EXCEPTION 'Commitment is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  IF c.state NOT IN ('planned','proposed') THEN RAISE EXCEPTION 'Only a planned or proposed commitment can be activated.' USING ERRCODE='22023'; END IF;
  SELECT * INTO w FROM public.pc_workstreams WHERE id=c.workstream_id AND active=1;
  IF NOT FOUND OR w.methodology='unspecified' THEN RAISE EXCEPTION 'Workstream methodology must be set before activation.' USING ERRCODE='22023'; END IF;
  IF c.accountable_owner_id IS NULL OR c.committed_date IS NULL OR length(trim(COALESCE(c.acceptance_criteria,'')))<5 THEN RAISE EXCEPTION 'Owner, committed date and acceptance criteria are required before activation.' USING ERRCODE='22023'; END IF;
  BEGIN v_spec:=c.evidence_spec_json::jsonb; EXCEPTION WHEN others THEN v_spec:='[]'::jsonb; END;
  IF jsonb_typeof(v_spec)<>'array' OR jsonb_array_length(v_spec)=0 THEN RAISE EXCEPTION 'Evidence specification is required before activation.' USING ERRCODE='22023'; END IF;
  IF length(trim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Activation reason is required.' USING ERRCODE='22023'; END IF;
  v_before:=c.revision;
  UPDATE public.pc_commitments SET state='active',updated_at=now()::text,revision=revision+1 WHERE id=c.id;
  PERFORM goliath_api.append_project_event(c.project_id,ctx->>'userId','commitment.activated','commitment',c.id,'recorded',trim(p_reason),v_before,v_before+1,jsonb_build_object('methodology',w.methodology,'evidenceSpec',v_spec));
  RETURN jsonb_build_object('commitmentId',c.id,'state','active','revision',v_before+1);
END $$;

CREATE OR REPLACE FUNCTION goliath_api.set_workstream_methodology(
  p_assignment_id text,
  p_workstream_id text,
  p_methodology text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; w public.pc_workstreams%ROWTYPE; v_before integer;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority is required.' USING ERRCODE='42501'; END IF;
  IF ctx->>'role' NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'This responsibility cannot change workstream methodology.' USING ERRCODE='42501'; END IF;
  SELECT * INTO w FROM public.pc_workstreams WHERE id=p_workstream_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,w.project_id) THEN RAISE EXCEPTION 'Workstream is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  IF p_methodology NOT IN ('agile','waterfall','hybrid') THEN RAISE EXCEPTION 'Methodology must be agile, waterfall or hybrid.' USING ERRCODE='22023'; END IF;
  IF length(trim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Methodology change reason is required.' USING ERRCODE='22023'; END IF;
  v_before:=w.revision;
  UPDATE public.pc_workstreams SET methodology=p_methodology,updated_at=now()::text,revision=revision+1 WHERE id=w.id;
  PERFORM goliath_api.append_project_event(w.project_id,ctx->>'userId','workstream.methodology.updated','workstream',w.id,'recorded',trim(p_reason),v_before,v_before+1,jsonb_build_object('methodology',p_methodology));
  RETURN jsonb_build_object('workstreamId',w.id,'methodology',p_methodology,'revision',v_before+1);
END $$;

REVOKE ALL ON FUNCTION goliath_api.set_commitment_evidence_spec(text,text,jsonb,text), goliath_api.activate_commitment(text,text,text), goliath_api.set_workstream_methodology(text,text,text,text) FROM PUBLIC, anonymous, goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.set_commitment_evidence_spec(text,text,jsonb,text), goliath_api.activate_commitment(text,text,text), goliath_api.set_workstream_methodology(text,text,text,text) TO authenticated;

COMMIT;

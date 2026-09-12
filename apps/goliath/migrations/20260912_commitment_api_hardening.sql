-- Apply data-class authorization consistently to commitment/evidence APIs.

BEGIN;

CREATE OR REPLACE FUNCTION goliath_api.commitment_candidate_queue(p_assignment_id text,p_project_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_role text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id); v_role:=c->>'role';
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'This responsibility cannot manage commitment candidates.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'workstreams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'methodology',w.methodology) ORDER BY w.name) FROM public.pc_workstreams w WHERE w.project_id=p_project_id AND w.active=1),'[]'::jsonb),
    'candidates',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'sourceType',x.source_type,'sourceRef',x.source_ref,'type',x.proposed_type,'title',x.proposed_title,'ownerId',x.proposed_owner_id,'date',x.proposed_date,'acceptanceCriteria',x.proposed_acceptance_criteria,'confidence',x.confidence,'status',x.status,'metadata',x.metadata_json::jsonb) ORDER BY x.proposed_date NULLS LAST,x.proposed_title) FROM public.pc_commitment_candidates x WHERE x.project_id=p_project_id AND x.status='proposed'),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION goliath_api.confirm_commitment_candidate(
  p_assignment_id text,p_candidate_id text,p_workstream_id text,p_type text,p_owner_id text,
  p_committed_date text,p_committed_date_kind text,p_acceptance_criteria text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_role text; x public.pc_commitment_candidates%ROWTYPE; a public.pc_activities%ROWTYPE; v_commitment_id text; v_source_status text; v_source_observed text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id); v_role:=c->>'role';
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority is required.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'This responsibility cannot confirm commitment candidates.' USING ERRCODE='42501'; END IF;
  SELECT * INTO x FROM public.pc_commitment_candidates WHERE id=p_candidate_id FOR UPDATE;
  IF NOT FOUND OR x.status<>'proposed' THEN RAISE EXCEPTION 'Commitment candidate is not available for confirmation.' USING ERRCODE='22023'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,x.project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pc_workstreams w WHERE w.id=p_workstream_id AND w.project_id=x.project_id AND w.active=1) THEN RAISE EXCEPTION 'Workstream is not active for the candidate project.' USING ERRCODE='22023'; END IF;
  IF p_owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.pc_project_members m WHERE m.project_id=x.project_id AND m.user_id=p_owner_id AND m.active=1) THEN RAISE EXCEPTION 'A current governed project member must be the accountable owner.' USING ERRCODE='22023'; END IF;
  IF p_committed_date IS NULL OR trim(p_committed_date)='' THEN RAISE EXCEPTION 'Committed date is required.' USING ERRCODE='22023'; END IF;
  IF p_committed_date_kind NOT IN ('contractual','internal-target') THEN RAISE EXCEPTION 'Committed date kind must be contractual or internal-target.' USING ERRCODE='22023'; END IF;
  IF p_acceptance_criteria IS NULL OR length(trim(p_acceptance_criteria))<5 THEN RAISE EXCEPTION 'Meaningful acceptance criteria are required before confirmation.' USING ERRCODE='22023'; END IF;
  v_commitment_id:='cmt-'||gen_random_uuid()::text;
  INSERT INTO public.pc_commitments(id,project_id,workstream_id,type,title,accountable_owner_id,committed_date,committed_date_kind,acceptance_criteria,state,origin,created_by,created_at,updated_at)
  VALUES(v_commitment_id,x.project_id,p_workstream_id,COALESCE(NULLIF(p_type,''),x.proposed_type),x.proposed_title,p_owner_id,p_committed_date,p_committed_date_kind,trim(p_acceptance_criteria),'planned','import-candidate',c->>'userId',now()::text,now()::text);
  SELECT * INTO a FROM public.pc_activities WHERE project_id=x.project_id AND id=x.source_ref;
  SELECT status,last_observed_at INTO v_source_status,v_source_observed FROM public.pc_sources WHERE project_id=x.project_id ORDER BY id LIMIT 1;
  INSERT INTO public.pc_evidence_links(project_id,commitment_id,evidence_kind,source_system,source_object_type,source_object_id,owner_system,source_version,source_updated_at,ingested_at,last_reconciled_at,mapping_version,freshness_state,lifecycle_state,ingestion_mode,classification,origin,metadata_json)
  VALUES(x.project_id,v_commitment_id,'work',COALESCE(NULLIF(a.source_system,''),x.source_type),'plan-row',x.source_ref,COALESCE(NULLIF(a.source_system,''),x.source_type),CASE WHEN x.source_type='controlled-plan' THEN 'v12-2026-09-05' ELSE NULL END,v_source_observed,now()::text,now()::text,'commitment-candidate-v1',CASE WHEN v_source_status IN ('current','stale','unavailable','unconfigured') THEN v_source_status ELSE 'unconfigured' END,'active','import','delivery','external-source',jsonb_build_object('candidateId',x.id,'activityStatus',a.status,'activityRevision',a.revision)::text);
  UPDATE public.pc_commitment_candidates SET status='confirmed',confirmed_commitment_id=v_commitment_id,resolved_by=c->>'userId',resolved_at=now()::text WHERE id=x.id;
  PERFORM goliath_api.append_project_event(x.project_id,c->>'userId','commitment.confirmed','commitment',v_commitment_id,'recorded','Brownfield/import candidate confirmed by a named human.',NULL,1,jsonb_build_object('candidateId',x.id,'sourceRef',x.source_ref,'committedDate',p_committed_date,'committedDateKind',p_committed_date_kind),jsonb_build_array(jsonb_build_object('system',COALESCE(NULLIF(a.source_system,''),x.source_type),'ref',x.source_ref)));
  RETURN jsonb_build_object('commitmentId',v_commitment_id,'projectId',x.project_id,'candidateId',x.id,'state','planned');
END $$;

CREATE OR REPLACE FUNCTION goliath_api.commitment_evidence_projection(p_assignment_id text,p_commitment_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_project_id text; v_partial boolean;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  SELECT project_id INTO v_project_id FROM public.pc_commitments WHERE id=p_commitment_id;
  IF v_project_id IS NULL THEN RAISE EXCEPTION 'Commitment not found.' USING ERRCODE='22023'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,v_project_id) THEN RAISE EXCEPTION 'Commitment is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.pc_evidence_links e WHERE e.commitment_id=p_commitment_id AND e.lifecycle_state<>'deleted' AND NOT goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')) INTO v_partial;
  RETURN jsonb_build_object(
    'commitmentId',p_commitment_id,'projectId',v_project_id,'partial',v_partial,
    'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.evidence_kind,'sourceSystem',e.source_system,'sourceObjectType',e.source_object_type,'sourceObjectId',e.source_object_id,'sourceUrl',e.source_url,'ownerSystem',e.owner_system,'sourceVersion',e.source_version,'sourceUpdatedAt',e.source_updated_at,'ingestedAt',e.ingested_at,'lastReconciledAt',e.last_reconciled_at,'mappingVersion',e.mapping_version,'freshness',e.freshness_state,'lifecycle',e.lifecycle_state,'ingestionMode',e.ingestion_mode,'classification',e.classification,'origin',e.origin,'provenanceComplete',(e.source_system IS NOT NULL AND e.owner_system IS NOT NULL AND e.source_object_id IS NOT NULL AND e.ingested_at IS NOT NULL)) ORDER BY e.ingested_at DESC) FROM public.pc_evidence_links e WHERE e.commitment_id=p_commitment_id AND e.lifecycle_state<>'deleted' AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')),'[]'::jsonb)
  );
END $$;

COMMIT;

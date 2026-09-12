-- Add governed member context to brownfield commitment candidate projection.

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
    'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',m.user_id,'displayName',m.display_name,'role',m.role,'teamId',m.team_id) ORDER BY m.display_name,m.user_id) FROM public.pc_project_members m WHERE m.project_id=p_project_id AND m.active=1),'[]'::jsonb),
    'candidates',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'sourceType',x.source_type,'sourceRef',x.source_ref,'type',x.proposed_type,'title',x.proposed_title,'ownerId',x.proposed_owner_id,'date',x.proposed_date,'acceptanceCriteria',x.proposed_acceptance_criteria,'confidence',x.confidence,'status',x.status,'metadata',x.metadata_json::jsonb) ORDER BY x.proposed_date NULLS LAST,x.proposed_title) FROM public.pc_commitment_candidates x WHERE x.project_id=p_project_id AND x.status='proposed'),'[]'::jsonb)
  );
END $$;

COMMIT;

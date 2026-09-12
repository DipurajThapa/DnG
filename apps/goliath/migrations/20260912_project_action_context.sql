-- Governed action context for project-control forms.

BEGIN;

CREATE OR REPLACE FUNCTION goliath_api.project_action_context(p_assignment_id text,p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_role text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id); v_role:=c->>'role';
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority is required.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('project-manager','project-director','program-manager','pmo','delivery-lead','agile-delivery-lead') THEN RAISE EXCEPTION 'Project action context is not available to this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',m.user_id,'displayName',m.display_name,'role',m.role,'teamId',m.team_id) ORDER BY m.display_name,m.user_id) FROM public.pc_project_members m WHERE m.project_id=p_project_id AND m.active=1),'[]'::jsonb),
    'commitments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cm.id,'title',cm.title,'type',cm.type,'ownerId',cm.accountable_owner_id,'committedDate',cm.committed_date,'state',cm.state) ORDER BY cm.committed_date NULLS LAST,cm.title) FROM public.pc_commitments cm WHERE cm.project_id=p_project_id AND cm.state NOT IN ('cancelled','closed')),'[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION goliath_api.project_action_context(text,text) FROM PUBLIC, anonymous, goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.project_action_context(text,text) TO authenticated;

COMMIT;

-- Goliath requirements + live traceability foundation
-- Date: 2026-09-12
-- Purpose: first-class requirements with versioned external mirrors and computed coverage.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pc_requirements (
  id text PRIMARY KEY DEFAULT ('req-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  master_system text NOT NULL,
  source_ref text NOT NULL,
  source_version text NOT NULL,
  verbatim_text text NOT NULL,
  mirrored_at text NOT NULL,
  owner_id text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','baselined','in-design','in-build','in-test','accepted','deployed','rejected','retired')),
  baselined_by text,
  baselined_at text,
  accepted_by text,
  accepted_at text,
  acceptance_evidence_refs_json text NOT NULL DEFAULT '[]',
  origin text NOT NULL DEFAULT 'human' CHECK (origin IN ('human','external-source','ai-proposed','ai-confirmed')),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(project_id,master_system,source_ref,source_version)
);
CREATE INDEX IF NOT EXISTS idx_pc_requirements_project_state ON public.pc_requirements(project_id,state,priority);

CREATE TABLE IF NOT EXISTS public.pc_requirement_links (
  id text PRIMARY KEY DEFAULT ('rql-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  requirement_id text NOT NULL REFERENCES public.pc_requirements(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN ('commitment','design','estimate','work-item','test','passed-test','defect','release','document','acceptance')),
  target_system text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  target_version text,
  state text NOT NULL DEFAULT 'confirmed' CHECK (state IN ('proposed','confirmed','rejected','stale')),
  origin text NOT NULL DEFAULT 'human' CHECK (origin IN ('human','ai-proposed','ai-confirmed','system','external-source')),
  confidence text CHECK (confidence IN ('high','medium','low','unknown')),
  confirmed_by text,
  confirmed_at text,
  source_ref text,
  created_at text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(requirement_id,link_type,target_system,target_type,target_id,target_version)
);
CREATE INDEX IF NOT EXISTS idx_pc_requirement_links_coverage ON public.pc_requirement_links(requirement_id,state,link_type);

CREATE OR REPLACE FUNCTION goliath_api.create_requirement(
  p_assignment_id text,
  p_project_id text,
  p_title text,
  p_master_system text,
  p_source_ref text,
  p_source_version text,
  p_verbatim_text text,
  p_owner_id text,
  p_priority text DEFAULT 'medium'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_id text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'Management responsibility required to create a governed requirement.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  IF COALESCE(length(trim(p_title)),0)<3 OR COALESCE(length(trim(p_verbatim_text)),0)<5 THEN RAISE EXCEPTION 'Requirement title and verbatim text are required.' USING ERRCODE='22023'; END IF;
  IF COALESCE(trim(p_master_system),'')='' OR COALESCE(trim(p_source_ref),'')='' OR COALESCE(trim(p_source_version),'')='' THEN RAISE EXCEPTION 'Master system, source reference and source version are required for traceability.' USING ERRCODE='22023'; END IF;
  IF p_priority NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'Unsupported priority.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pc_project_members WHERE project_id=p_project_id AND user_id=p_owner_id AND active=1) THEN RAISE EXCEPTION 'Requirement owner must be an active governed project member.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.pc_requirements(project_id,title,master_system,source_ref,source_version,verbatim_text,mirrored_at,owner_id,priority,state,origin,created_at,updated_at)
  VALUES(p_project_id,trim(p_title),trim(p_master_system),trim(p_source_ref),trim(p_source_version),p_verbatim_text,now()::text,p_owner_id,p_priority,'proposed',CASE WHEN lower(trim(p_master_system))='goliath' THEN 'human' ELSE 'external-source' END,now()::text,now()::text)
  RETURNING id INTO v_id;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','requirement.created','requirement',v_id,'recorded','Requirement object created with versioned source mirror.',NULL,1,jsonb_build_object('masterSystem',p_master_system,'sourceRef',p_source_ref,'sourceVersion',p_source_version));
  RETURN jsonb_build_object('requirementId',v_id,'state','proposed');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.link_requirement(
  p_assignment_id text,
  p_requirement_id text,
  p_link_type text,
  p_target_system text,
  p_target_type text,
  p_target_id text,
  p_target_version text DEFAULT NULL,
  p_origin text DEFAULT 'human',
  p_confidence text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; r public.pc_requirements%ROWTYPE; v_id text; v_state text; v_confirmed_by text; v_confirmed_at text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  SELECT * INTO r FROM public.pc_requirements WHERE id=p_requirement_id;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,r.project_id) THEN RAISE EXCEPTION 'Requirement is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  IF p_link_type NOT IN ('commitment','design','estimate','work-item','test','passed-test','defect','release','document','acceptance') THEN RAISE EXCEPTION 'Unsupported requirement link type.' USING ERRCODE='22023'; END IF;
  IF p_origin NOT IN ('human','ai-proposed','ai-confirmed','system','external-source') THEN RAISE EXCEPTION 'Unsupported link origin.' USING ERRCODE='22023'; END IF;
  IF p_link_type='commitment' AND NOT EXISTS(SELECT 1 FROM public.pc_commitments WHERE id=p_target_id AND project_id=r.project_id) THEN RAISE EXCEPTION 'Commitment link target is outside the requirement project.' USING ERRCODE='22023'; END IF;
  v_state:=CASE WHEN p_origin='ai-proposed' THEN 'proposed' ELSE 'confirmed' END;
  v_confirmed_by:=CASE WHEN v_state='confirmed' THEN ctx->>'userId' ELSE NULL END;
  v_confirmed_at:=CASE WHEN v_state='confirmed' THEN now()::text ELSE NULL END;
  INSERT INTO public.pc_requirement_links(project_id,requirement_id,link_type,target_system,target_type,target_id,target_version,state,origin,confidence,confirmed_by,confirmed_at,created_at)
  VALUES(r.project_id,r.id,p_link_type,p_target_system,p_target_type,p_target_id,p_target_version,v_state,p_origin,p_confidence,v_confirmed_by,v_confirmed_at,now()::text)
  RETURNING id INTO v_id;
  PERFORM goliath_api.append_project_event(r.project_id,ctx->>'userId','requirement.link.'||v_state,'requirement-link',v_id,'recorded','Requirement traceability link recorded.',NULL,1,jsonb_build_object('requirementId',r.id,'linkType',p_link_type,'targetSystem',p_target_system,'targetId',p_target_id,'origin',p_origin));
  RETURN jsonb_build_object('linkId',v_id,'state',v_state);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.confirm_requirement_link(
  p_assignment_id text,
  p_link_id text,
  p_accept boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; l public.pc_requirement_links%ROWTYPE;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  SELECT * INTO l FROM public.pc_requirement_links WHERE id=p_link_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,l.project_id) THEN RAISE EXCEPTION 'Link is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF l.state<>'proposed' THEN RAISE EXCEPTION 'Only a proposed link can be confirmed/rejected.' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(trim(p_reason)),0)<3 THEN RAISE EXCEPTION 'Confirmation/rejection reason is required.' USING ERRCODE='22023'; END IF;
  UPDATE public.pc_requirement_links SET state=CASE WHEN p_accept THEN 'confirmed' ELSE 'rejected' END,origin=CASE WHEN p_accept AND l.origin='ai-proposed' THEN 'ai-confirmed' ELSE origin END,confirmed_by=ctx->>'userId',confirmed_at=now()::text,revision=revision+1 WHERE id=l.id;
  PERFORM goliath_api.append_project_event(l.project_id,ctx->>'userId','requirement.link.'||CASE WHEN p_accept THEN 'confirmed' ELSE 'rejected' END,'requirement-link',l.id,'recorded',trim(p_reason),l.revision,l.revision+1,jsonb_build_object('requirementId',l.requirement_id));
  RETURN jsonb_build_object('linkId',l.id,'state',CASE WHEN p_accept THEN 'confirmed' ELSE 'rejected' END);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.baseline_requirement(
  p_assignment_id text,
  p_requirement_id text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; r public.pc_requirements%ROWTYPE;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','pmo') THEN RAISE EXCEPTION 'Project baseline authority required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.pc_requirements WHERE id=p_requirement_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,r.project_id) THEN RAISE EXCEPTION 'Requirement is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF r.state<>'proposed' THEN RAISE EXCEPTION 'Only proposed requirements can be baselined through this action.' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(trim(p_reason)),0)<5 THEN RAISE EXCEPTION 'Baselining rationale is required.' USING ERRCODE='22023'; END IF;
  UPDATE public.pc_requirements SET state='baselined',baselined_by=ctx->>'userId',baselined_at=now()::text,updated_at=now()::text,revision=revision+1 WHERE id=r.id;
  PERFORM goliath_api.append_project_event(r.project_id,ctx->>'userId','requirement.baselined','requirement',r.id,'recorded',trim(p_reason),r.revision,r.revision+1,jsonb_build_object('sourceVersion',r.source_version));
  RETURN jsonb_build_object('requirementId',r.id,'state','baselined');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.accept_requirement(
  p_assignment_id text,
  p_requirement_id text,
  p_evidence_refs jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; r public.pc_requirements%ROWTYPE;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','sponsor') THEN RAISE EXCEPTION 'Named acceptance authority is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.pc_requirements WHERE id=p_requirement_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,r.project_id) THEN RAISE EXCEPTION 'Requirement is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF r.state NOT IN ('in-test','baselined','in-build') THEN RAISE EXCEPTION 'Requirement is not in an accept-ready lifecycle state.' USING ERRCODE='22023'; END IF;
  IF COALESCE(jsonb_array_length(COALESCE(p_evidence_refs,'[]'::jsonb)),0)=0 THEN RAISE EXCEPTION 'Acceptance requires evidence references.' USING ERRCODE='22023'; END IF;
  IF COALESCE(length(trim(p_reason)),0)<5 THEN RAISE EXCEPTION 'Acceptance rationale is required.' USING ERRCODE='22023'; END IF;
  UPDATE public.pc_requirements SET state='accepted',accepted_by=ctx->>'userId',accepted_at=now()::text,acceptance_evidence_refs_json=p_evidence_refs::text,updated_at=now()::text,revision=revision+1 WHERE id=r.id;
  PERFORM goliath_api.append_project_event(r.project_id,ctx->>'userId','requirement.accepted','requirement',r.id,'recorded',trim(p_reason),r.revision,r.revision+1,jsonb_build_object('evidenceRefs',p_evidence_refs));
  RETURN jsonb_build_object('requirementId',r.id,'state','accepted');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.requirement_coverage(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
BEGIN
  PERFORM goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'requirementId',r.id,'title',r.title,'state',r.state,'priority',r.priority,'ownerId',r.owner_id,
    'source',jsonb_build_object('system',r.master_system,'ref',r.source_ref,'version',r.source_version,'mirroredAt',r.mirrored_at),
    'coverage',jsonb_build_object(
      'commitment',EXISTS(SELECT 1 FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='confirmed' AND l.link_type='commitment'),
      'design',EXISTS(SELECT 1 FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='confirmed' AND l.link_type='design'),
      'estimate',EXISTS(SELECT 1 FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='confirmed' AND l.link_type='estimate'),
      'work',EXISTS(SELECT 1 FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='confirmed' AND l.link_type='work-item'),
      'test',EXISTS(SELECT 1 FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='confirmed' AND l.link_type IN ('test','passed-test')),
      'passedTest',EXISTS(SELECT 1 FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='confirmed' AND l.link_type='passed-test'),
      'acceptance',(r.state IN ('accepted','deployed')) OR EXISTS(SELECT 1 FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='confirmed' AND l.link_type='acceptance')
    ),
    'proposedLinkCount',(SELECT count(*) FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='proposed')
  ) ORDER BY r.priority DESC,r.id) FROM public.pc_requirements r WHERE r.project_id=p_project_id AND r.state NOT IN ('rejected','retired')),'[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.requirements_view(p_assignment_id text,p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
BEGIN
  RETURN jsonb_build_object('projectId',p_project_id,'requirements',goliath_api.requirement_coverage(p_assignment_id,p_project_id),'manualTraceabilityMatrixRequired',false);
END
$$;

-- Baseline snapshot now includes versioned requirement mirrors and only confirmed traceability links.
CREATE OR REPLACE FUNCTION goliath_api.current_baseline_snapshot_json(p_project_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
SELECT jsonb_build_object(
  'project',jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'lifecycle',p.lifecycle,'timezone',p.timezone),
  'workstreams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'methodology',w.methodology,'revision',w.revision) ORDER BY w.id) FROM public.pc_workstreams w WHERE w.project_id=p.id AND w.active=1),'[]'::jsonb),
  'commitments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'type',c.type,'title',c.title,'ownerId',c.accountable_owner_id,'committedDate',c.committed_date,'committedDateKind',c.committed_date_kind,'acceptanceCriteria',c.acceptance_criteria,'evidenceSpec',c.evidence_spec_json::jsonb,'state',c.state,'revision',c.revision) ORDER BY c.id) FROM public.pc_commitments c WHERE c.project_id=p.id AND c.state NOT IN ('cancelled','closed')),'[]'::jsonb),
  'requirements',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',r.id,'title',r.title,'masterSystem',r.master_system,'sourceRef',r.source_ref,'sourceVersion',r.source_version,
    'verbatimText',r.verbatim_text,'ownerId',r.owner_id,'priority',r.priority,'state',r.state,'revision',r.revision,
    'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('type',l.link_type,'targetSystem',l.target_system,'targetType',l.target_type,'targetId',l.target_id,'targetVersion',l.target_version,'origin',l.origin) ORDER BY l.link_type,l.target_id) FROM public.pc_requirement_links l WHERE l.requirement_id=r.id AND l.state='confirmed'),'[]'::jsonb)
  ) ORDER BY r.id) FROM public.pc_requirements r WHERE r.project_id=p.id AND r.state NOT IN ('rejected','retired')),'[]'::jsonb)
) FROM public.pc_projects p WHERE p.id=p_project_id;
$$;

REVOKE ALL ON FUNCTION goliath_api.create_requirement(text,text,text,text,text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.link_requirement(text,text,text,text,text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.confirm_requirement_link(text,text,boolean,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.baseline_requirement(text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.accept_requirement(text,text,jsonb,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.requirement_coverage(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.requirements_view(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.create_requirement(text,text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.link_requirement(text,text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.confirm_requirement_link(text,text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.baseline_requirement(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.accept_requirement(text,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.requirement_coverage(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.requirements_view(text,text) TO authenticated;

COMMIT;

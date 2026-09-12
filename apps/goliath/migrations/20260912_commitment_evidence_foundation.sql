-- Goliath commitment/evidence foundation
-- Date: 2026-09-12
-- Purpose: Add the first-class management objects required by the research-backed
-- Commitment + Evidence + Decision Intelligence direction without removing the
-- existing activity/task migration model.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pc_workstreams (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  methodology text NOT NULL DEFAULT 'unspecified'
    CHECK (methodology IN ('agile','waterfall','hybrid','unspecified')),
  source_system text NOT NULL DEFAULT 'goliath',
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(project_id,name)
);

CREATE TABLE IF NOT EXISTS public.pc_commitments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  workstream_id text NOT NULL REFERENCES public.pc_workstreams(id),
  type text NOT NULL
    CHECK (type IN ('milestone','deliverable','release','handover','closure','obligation','other')),
  title text NOT NULL,
  accountable_owner_id text,
  consumer_refs_json text NOT NULL DEFAULT '[]',
  committed_date text,
  committed_date_kind text
    CHECK (committed_date_kind IN ('contractual','internal-target')),
  forecast_date text,
  client_visible_forecast integer NOT NULL DEFAULT 0
    CHECK (client_visible_forecast IN (0,1)),
  acceptance_criteria text,
  evidence_spec_json text NOT NULL DEFAULT '[]',
  evidence_maturity text NOT NULL DEFAULT 'none'
    CHECK (evidence_maturity IN ('none','created','reviewed','verified','accepted','verified-in-production')),
  state text NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed','planned','active','ready-for-acceptance','accepted','waived','cancelled','closed')),
  escalation_path_json text NOT NULL DEFAULT '[]',
  origin text NOT NULL DEFAULT 'human'
    CHECK (origin IN ('human','import-candidate','ai-proposed','ai-confirmed','system')),
  created_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  CHECK (
    state='proposed' OR
    (
      accountable_owner_id IS NOT NULL AND
      committed_date IS NOT NULL AND
      acceptance_criteria IS NOT NULL AND
      length(trim(acceptance_criteria)) > 0
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_pc_commitments_project_state
  ON public.pc_commitments(project_id,state);
CREATE INDEX IF NOT EXISTS idx_pc_commitments_owner_state
  ON public.pc_commitments(accountable_owner_id,state);

CREATE TABLE IF NOT EXISTS public.pc_commitment_candidates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_ref text NOT NULL,
  proposed_type text NOT NULL
    CHECK (proposed_type IN ('milestone','deliverable','release','handover','closure','obligation','other')),
  proposed_title text NOT NULL,
  proposed_owner_id text,
  proposed_date text,
  proposed_acceptance_criteria text,
  confidence text NOT NULL DEFAULT 'unknown'
    CHECK (confidence IN ('high','medium','low','unknown')),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','confirmed','merged','discarded')),
  confirmed_commitment_id text REFERENCES public.pc_commitments(id),
  created_at text NOT NULL,
  resolved_by text,
  resolved_at text,
  metadata_json text NOT NULL DEFAULT '{}',
  UNIQUE(project_id,source_type,source_ref)
);

CREATE INDEX IF NOT EXISTS idx_pc_commitment_candidates_project_status
  ON public.pc_commitment_candidates(project_id,status);

CREATE TABLE IF NOT EXISTS public.pc_evidence_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  commitment_id text NOT NULL REFERENCES public.pc_commitments(id) ON DELETE CASCADE,
  evidence_kind text NOT NULL
    CHECK (evidence_kind IN ('work','test','acceptance','document','approval','deployment','financial','decision','dependency','other')),
  source_system text NOT NULL,
  source_object_type text NOT NULL,
  source_object_id text NOT NULL,
  source_url text,
  owner_system text NOT NULL,
  source_version text,
  source_updated_at text,
  ingested_at text NOT NULL,
  last_reconciled_at text,
  mapping_version text,
  freshness_state text NOT NULL DEFAULT 'current'
    CHECK (freshness_state IN ('current','stale','unavailable','backfilling','unconfigured')),
  lifecycle_state text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active','moved','deleted','merged','disconnected')),
  ingestion_mode text NOT NULL
    CHECK (ingestion_mode IN ('tenant-owned','delegated','import','manual')),
  classification text NOT NULL DEFAULT 'delivery'
    CHECK (classification IN ('delivery','financial-cost','financial-billing','hr','client-confidential','audit')),
  origin text NOT NULL
    CHECK (origin IN ('external-source','human','system-computed','ai-proposed','ai-confirmed')),
  metadata_json text NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(commitment_id,source_system,source_object_type,source_object_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_evidence_links_commitment_state
  ON public.pc_evidence_links(commitment_id,freshness_state,lifecycle_state);

CREATE OR REPLACE FUNCTION goliath_api.commitment_candidate_queue(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  v_role text;
BEGIN
  c := goliath_api.require_context(p_assignment_id);
  v_role := c->>'role';

  IF v_role NOT IN ('project-manager','project-director','pmo') THEN
    RAISE EXCEPTION 'This responsibility cannot manage commitment candidates.'
      USING ERRCODE='42501';
  END IF;

  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.'
      USING ERRCODE='42501';
  END IF;

  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'workstreams',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id',w.id,'name',w.name,'methodology',w.methodology)
        ORDER BY w.name
      )
      FROM pc_workstreams w
      WHERE w.project_id=p_project_id AND w.active=1
    ),'[]'::jsonb),
    'candidates',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',x.id,
          'sourceType',x.source_type,
          'sourceRef',x.source_ref,
          'type',x.proposed_type,
          'title',x.proposed_title,
          'ownerId',x.proposed_owner_id,
          'date',x.proposed_date,
          'acceptanceCriteria',x.proposed_acceptance_criteria,
          'confidence',x.confidence,
          'status',x.status,
          'metadata',x.metadata_json::jsonb
        )
        ORDER BY x.proposed_date NULLS LAST,x.proposed_title
      )
      FROM pc_commitment_candidates x
      WHERE x.project_id=p_project_id AND x.status='proposed'
    ),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.confirm_commitment_candidate(
  p_assignment_id text,
  p_candidate_id text,
  p_workstream_id text,
  p_type text,
  p_owner_id text,
  p_committed_date text,
  p_committed_date_kind text,
  p_acceptance_criteria text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  v_role text;
  x pc_commitment_candidates%ROWTYPE;
  a pc_activities%ROWTYPE;
  v_commitment_id text;
  v_source_status text;
  v_source_observed text;
BEGIN
  c := goliath_api.require_context(p_assignment_id);
  v_role := c->>'role';

  IF v_role NOT IN ('project-manager','project-director','pmo') THEN
    RAISE EXCEPTION 'This responsibility cannot confirm commitment candidates.'
      USING ERRCODE='42501';
  END IF;

  SELECT * INTO x
  FROM pc_commitment_candidates
  WHERE id=p_candidate_id
  FOR UPDATE;

  IF NOT FOUND OR x.status<>'proposed' THEN
    RAISE EXCEPTION 'Commitment candidate is not available for confirmation.'
      USING ERRCODE='22023';
  END IF;

  IF NOT goliath_api.context_allows_project(p_assignment_id,x.project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.'
      USING ERRCODE='42501';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pc_workstreams w
    WHERE w.id=p_workstream_id AND w.project_id=x.project_id AND w.active=1
  ) THEN
    RAISE EXCEPTION 'Workstream is not active for the candidate project.'
      USING ERRCODE='22023';
  END IF;

  IF p_owner_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM pc_project_members m
    WHERE m.project_id=x.project_id AND m.user_id=p_owner_id AND m.active=1
  ) THEN
    RAISE EXCEPTION 'A current governed project member must be the accountable owner.'
      USING ERRCODE='22023';
  END IF;

  IF p_committed_date IS NULL OR trim(p_committed_date)='' THEN
    RAISE EXCEPTION 'Committed date is required.' USING ERRCODE='22023';
  END IF;

  IF p_committed_date_kind NOT IN ('contractual','internal-target') THEN
    RAISE EXCEPTION 'Committed date kind must be contractual or internal-target.'
      USING ERRCODE='22023';
  END IF;

  IF p_acceptance_criteria IS NULL OR length(trim(p_acceptance_criteria))<5 THEN
    RAISE EXCEPTION 'Meaningful acceptance criteria are required before confirmation.'
      USING ERRCODE='22023';
  END IF;

  v_commitment_id := 'cmt-'||gen_random_uuid()::text;

  INSERT INTO pc_commitments(
    id,project_id,workstream_id,type,title,accountable_owner_id,
    committed_date,committed_date_kind,acceptance_criteria,state,origin,
    created_by,created_at,updated_at
  ) VALUES(
    v_commitment_id,x.project_id,p_workstream_id,
    COALESCE(NULLIF(p_type,''),x.proposed_type),x.proposed_title,p_owner_id,
    p_committed_date,p_committed_date_kind,trim(p_acceptance_criteria),
    'planned','import-candidate',c->>'userId',now()::text,now()::text
  );

  SELECT * INTO a
  FROM pc_activities
  WHERE project_id=x.project_id AND id=x.source_ref;

  SELECT status,last_observed_at
  INTO v_source_status,v_source_observed
  FROM pc_sources
  WHERE project_id=x.project_id
  ORDER BY id
  LIMIT 1;

  INSERT INTO pc_evidence_links(
    project_id,commitment_id,evidence_kind,source_system,source_object_type,
    source_object_id,owner_system,source_version,source_updated_at,ingested_at,
    last_reconciled_at,mapping_version,freshness_state,lifecycle_state,
    ingestion_mode,classification,origin,metadata_json
  ) VALUES(
    x.project_id,v_commitment_id,'work',
    COALESCE(NULLIF(a.source_system,''),x.source_type),'plan-row',x.source_ref,
    COALESCE(NULLIF(a.source_system,''),x.source_type),
    CASE WHEN x.source_type='controlled-plan' THEN 'v12-2026-09-05' ELSE NULL END,
    v_source_observed,now()::text,now()::text,'commitment-candidate-v1',
    CASE WHEN v_source_status IN ('current','stale','unavailable','unconfigured')
      THEN v_source_status ELSE 'unconfigured' END,
    'active','import','delivery','external-source',
    jsonb_build_object(
      'candidateId',x.id,
      'activityStatus',a.status,
      'activityRevision',a.revision
    )::text
  );

  UPDATE pc_commitment_candidates
  SET status='confirmed',
      confirmed_commitment_id=v_commitment_id,
      resolved_by=c->>'userId',
      resolved_at=now()::text
  WHERE id=x.id;

  PERFORM goliath_api.append_project_event(
    x.project_id,c->>'userId','commitment.confirmed','commitment',v_commitment_id,
    'recorded','Brownfield/import candidate confirmed by a named human.',
    NULL,1,
    jsonb_build_object(
      'candidateId',x.id,
      'sourceRef',x.source_ref,
      'committedDate',p_committed_date,
      'committedDateKind',p_committed_date_kind
    ),
    jsonb_build_array(
      jsonb_build_object(
        'system',COALESCE(NULLIF(a.source_system,''),x.source_type),
        'ref',x.source_ref
      )
    )
  );

  RETURN jsonb_build_object(
    'commitmentId',v_commitment_id,
    'projectId',x.project_id,
    'candidateId',x.id,
    'state','planned'
  );
END
$$;

REVOKE ALL ON FUNCTION goliath_api.commitment_candidate_queue(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.confirm_commitment_candidate(text,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.commitment_candidate_queue(text,text) FROM anonymous;
REVOKE ALL ON FUNCTION goliath_api.confirm_commitment_candidate(text,text,text,text,text,text,text,text) FROM anonymous;
REVOKE ALL ON FUNCTION goliath_api.commitment_candidate_queue(text,text) FROM goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.confirm_commitment_candidate(text,text,text,text,text,text,text,text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.commitment_candidate_queue(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.confirm_commitment_candidate(text,text,text,text,text,text,text,text) TO authenticated;

COMMIT;

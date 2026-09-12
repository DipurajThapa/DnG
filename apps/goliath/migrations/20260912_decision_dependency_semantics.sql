-- Goliath decision intelligence and two-party dependency semantics
-- Development branch only. Existing activity-to-activity dependencies remain execution evidence.

BEGIN;

ALTER TABLE public.pc_decisions ALTER COLUMN attention_item_id DROP NOT NULL;
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS question text;
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS options_json text NOT NULL DEFAULT '[]';
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS recommendation text;
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS recommendation_origin text;
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS needed_by text;
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS impact_if_late text;
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS impact_weight integer NOT NULL DEFAULT 1;
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS delegated_to text;
ALTER TABLE public.pc_decisions ADD COLUMN IF NOT EXISTS reopened_from_decision_id text;

CREATE INDEX IF NOT EXISTS idx_pc_decisions_needed_by_state
  ON public.pc_decisions(state,needed_by,decision_owner_id);

CREATE TABLE IF NOT EXISTS public.pc_decision_commitments (
  decision_id text NOT NULL REFERENCES public.pc_decisions(id) ON DELETE CASCADE,
  commitment_id text NOT NULL REFERENCES public.pc_commitments(id) ON DELETE CASCADE,
  impact_kind text NOT NULL DEFAULT 'blocked-by-decision'
    CHECK (impact_kind IN ('blocked-by-decision','schedule','scope','cost','dependency','acceptance','other')),
  PRIMARY KEY(decision_id,commitment_id)
);

CREATE TABLE IF NOT EXISTS public.pc_commitment_dependencies (
  id text PRIMARY KEY DEFAULT ('dep-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  consumer_commitment_id text NOT NULL REFERENCES public.pc_commitments(id) ON DELETE CASCADE,
  provider_type text NOT NULL CHECK (provider_type IN ('commitment','person','team','party')),
  provider_ref text NOT NULL,
  provider_commitment_id text REFERENCES public.pc_commitments(id),
  needed_by text NOT NULL,
  promised_date text,
  acceptance_criteria text NOT NULL,
  provider_acknowledged_by text,
  provider_acknowledged_at text,
  consumer_acknowledged_by text,
  consumer_acknowledged_at text,
  state text NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed','acknowledged','on-track','at-risk','late','accepted','renegotiation','cancelled')),
  current_reason text,
  origin text NOT NULL DEFAULT 'human'
    CHECK (origin IN ('human','import-candidate','ai-proposed','ai-confirmed','system')),
  created_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  CHECK ((provider_type='commitment' AND provider_commitment_id IS NOT NULL) OR provider_type<>'commitment'),
  UNIQUE(consumer_commitment_id,provider_type,provider_ref,needed_by)
);

CREATE INDEX IF NOT EXISTS idx_pc_commitment_dependencies_consumer
  ON public.pc_commitment_dependencies(project_id,consumer_commitment_id,state,needed_by);
CREATE INDEX IF NOT EXISTS idx_pc_commitment_dependencies_provider_commitment
  ON public.pc_commitment_dependencies(provider_commitment_id,state,promised_date);

CREATE OR REPLACE FUNCTION goliath_api.create_decision(
  p_assignment_id text,
  p_project_id text,
  p_question text,
  p_decision_owner_id text,
  p_needed_by text,
  p_impact_if_late text,
  p_impact_weight integer DEFAULT 1,
  p_options jsonb DEFAULT '[]'::jsonb,
  p_recommendation text DEFAULT NULL,
  p_recommendation_origin text DEFAULT 'human',
  p_commitment_ids jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  v_role text;
  v_id text := 'dec-'||gen_random_uuid()::text;
  v_commitment text;
BEGIN
  c := goliath_api.require_context(p_assignment_id);
  v_role := c->>'role';

  IF v_role NOT IN ('project-manager','project-director','program-manager','pmo','delivery-lead','agile-delivery-lead') THEN
    RAISE EXCEPTION 'This responsibility cannot create a governed decision.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_question),'')='' OR COALESCE(trim(p_needed_by),'')='' THEN
    RAISE EXCEPTION 'Decision question and needed-by date are required.' USING ERRCODE='22023';
  END IF;
  IF p_impact_weight < 1 OR p_impact_weight > 5 THEN
    RAISE EXCEPTION 'Impact weight must be between 1 and 5.' USING ERRCODE='22023';
  END IF;
  IF p_recommendation_origin NOT IN ('human','ai-proposed','ai-confirmed','system-computed','external-source') THEN
    RAISE EXCEPTION 'Unsupported recommendation origin.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.pc_project_members m
    WHERE m.project_id=p_project_id AND m.user_id=p_decision_owner_id AND m.active=1
  ) THEN
    RAISE EXCEPTION 'Decision owner must be an active governed project member in the current MVP.' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.pc_decisions(
    id,project_id,attention_item_id,decision_owner_id,state,evidence_refs_json,
    created_at,revision,question,options_json,recommendation,recommendation_origin,
    needed_by,impact_if_late,impact_weight
  ) VALUES(
    v_id,p_project_id,NULL,p_decision_owner_id,'pending','[]',now()::text,1,
    trim(p_question),COALESCE(p_options,'[]'::jsonb)::text,NULLIF(trim(p_recommendation),''),
    p_recommendation_origin,p_needed_by,NULLIF(trim(p_impact_if_late),''),p_impact_weight
  );

  FOR v_commitment IN SELECT jsonb_array_elements_text(COALESCE(p_commitment_ids,'[]'::jsonb))
  LOOP
    IF NOT EXISTS(SELECT 1 FROM public.pc_commitments WHERE id=v_commitment AND project_id=p_project_id) THEN
      RAISE EXCEPTION 'Linked commitment % is not in the decision project.',v_commitment USING ERRCODE='22023';
    END IF;
    INSERT INTO public.pc_decision_commitments(decision_id,commitment_id)
    VALUES(v_id,v_commitment)
    ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM goliath_api.append_project_event(
    p_project_id,c->>'userId','decision.created','decision',v_id,'recorded',
    'Governed decision created with named decider and needed-by date.',NULL,1,
    jsonb_build_object('decisionOwnerId',p_decision_owner_id,'neededBy',p_needed_by,'impactWeight',p_impact_weight)
  );

  RETURN jsonb_build_object('decisionId',v_id,'projectId',p_project_id,'state','pending');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.delegate_decision(
  p_assignment_id text,
  p_decision_id text,
  p_delegate_user_id text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  d public.pc_decisions%ROWTYPE;
BEGIN
  c := goliath_api.require_context(p_assignment_id);
  SELECT * INTO d FROM public.pc_decisions WHERE id=p_decision_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,d.project_id) THEN
    RAISE EXCEPTION 'Decision is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF d.state<>'pending' THEN
    RAISE EXCEPTION 'Only a pending decision can be delegated.' USING ERRCODE='22023';
  END IF;
  IF d.decision_owner_id<>c->>'userId' THEN
    RAISE EXCEPTION 'Only the named decision owner may delegate this decision.' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_reason),'')='' THEN
    RAISE EXCEPTION 'Delegation reason is required.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pc_project_members WHERE project_id=d.project_id AND user_id=p_delegate_user_id AND active=1) THEN
    RAISE EXCEPTION 'Delegate must be an active governed project member in the current MVP.' USING ERRCODE='22023';
  END IF;

  UPDATE public.pc_decisions
  SET delegated_to=p_delegate_user_id,reason=trim(p_reason),revision=revision+1
  WHERE id=d.id;

  PERFORM goliath_api.append_project_event(
    d.project_id,c->>'userId','decision.delegated','decision',d.id,'recorded',trim(p_reason),
    d.revision,d.revision+1,jsonb_build_object('delegateUserId',p_delegate_user_id)
  );

  RETURN jsonb_build_object('decisionId',d.id,'delegatedTo',p_delegate_user_id);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.decision_queue(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  v_user text;
  v_role text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_user:=c->>'userId';
  v_role:=c->>'role';

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',d.id,
      'projectId',d.project_id,
      'question',COALESCE(d.question,d.choice,d.id),
      'decisionOwnerId',d.decision_owner_id,
      'delegatedTo',d.delegated_to,
      'neededBy',d.needed_by,
      'impactIfLate',d.impact_if_late,
      'impactWeight',d.impact_weight,
      'options',d.options_json::jsonb,
      'recommendation',d.recommendation,
      'recommendationOrigin',d.recommendation_origin,
      'state',d.state,
      'choice',d.choice,
      'reason',d.reason,
      'createdAt',d.created_at,
      'decidedAt',d.decided_at,
      'revision',d.revision,
      'canResolve',(d.state='pending' AND (d.decision_owner_id=v_user OR d.delegated_to=v_user)),
      'overdue',(d.state='pending' AND d.needed_by IS NOT NULL AND d.needed_by < current_date::text),
      'linkedCommitments',COALESCE((SELECT jsonb_agg(dc.commitment_id ORDER BY dc.commitment_id) FROM public.pc_decision_commitments dc WHERE dc.decision_id=d.id),'[]'::jsonb)
    ) ORDER BY (d.state='pending') DESC,d.needed_by NULLS LAST,d.created_at,d.id)
    FROM public.pc_decisions d
    WHERE goliath_api.context_allows_project(p_assignment_id,d.project_id)
      AND (
        v_role IN ('project-manager','project-director','pmo','program-manager')
        OR d.decision_owner_id=v_user
        OR d.delegated_to=v_user
      )
  ),'[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.resolve_decision(
  p_assignment_id text,
  p_decision_id text,
  p_state text,
  p_choice text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  d public.pc_decisions%ROWTYPE;
  v_user text;
  v_before integer;
  v_at text:=clock_timestamp()::text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_user:=c->>'userId';
  SELECT * INTO d FROM public.pc_decisions WHERE id=p_decision_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,d.project_id) THEN
    RAISE EXCEPTION 'Decision is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF d.state<>'pending' THEN
    RAISE EXCEPTION 'Only a pending decision can be resolved.' USING ERRCODE='22023';
  END IF;
  IF p_state NOT IN ('approved','rejected','selected') THEN
    RAISE EXCEPTION 'Decision state must be approved, rejected or selected.' USING ERRCODE='22023';
  END IF;
  IF NOT (d.decision_owner_id=v_user OR d.delegated_to=v_user) THEN
    RAISE EXCEPTION 'Only the named decider or their recorded delegate may decide.' USING ERRCODE='42501';
  END IF;
  IF COALESCE(trim(p_choice),'')='' THEN
    RAISE EXCEPTION 'Decision choice is required.' USING ERRCODE='22023';
  END IF;
  IF COALESCE(trim(p_reason),'')='' THEN
    RAISE EXCEPTION 'Decision rationale is required.' USING ERRCODE='22023';
  END IF;

  v_before:=d.revision;
  UPDATE public.pc_decisions
  SET state=p_state,choice=trim(p_choice),reason=trim(p_reason),decided_by=v_user,
      decided_at=v_at,revision=revision+1
  WHERE id=d.id;

  SELECT * INTO d FROM public.pc_decisions WHERE id=p_decision_id;
  PERFORM goliath_api.append_project_event(
    d.project_id,v_user,'decision.'||p_state,'decision',d.id,'allowed',d.reason,
    v_before,d.revision,jsonb_build_object('choice',d.choice,'state',d.state,'neededBy',d.needed_by)
  );
  RETURN to_jsonb(d);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.decision_debt_summary(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  RETURN jsonb_build_object(
    'open',COALESCE((SELECT count(*) FROM public.pc_decisions d WHERE d.state='pending' AND goliath_api.context_allows_project(p_assignment_id,d.project_id)),0),
    'overdue',COALESCE((SELECT count(*) FROM public.pc_decisions d WHERE d.state='pending' AND d.needed_by IS NOT NULL AND d.needed_by<current_date::text AND goliath_api.context_allows_project(p_assignment_id,d.project_id)),0),
    'debtScore',COALESCE((SELECT sum(d.impact_weight * GREATEST(1,(current_date-NULLIF(d.needed_by,'')::date))) FROM public.pc_decisions d WHERE d.state='pending' AND d.needed_by IS NOT NULL AND d.needed_by<current_date::text AND goliath_api.context_allows_project(p_assignment_id,d.project_id)),0)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.create_commitment_dependency(
  p_assignment_id text,
  p_consumer_commitment_id text,
  p_provider_type text,
  p_provider_ref text,
  p_needed_by text,
  p_acceptance_criteria text,
  p_provider_commitment_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  v_role text;
  v_project_id text;
  v_id text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_role:=c->>'role';
  IF v_role NOT IN ('project-manager','project-director','program-manager','pmo') THEN
    RAISE EXCEPTION 'This responsibility cannot create a governed dependency.' USING ERRCODE='42501';
  END IF;

  SELECT project_id INTO v_project_id FROM public.pc_commitments WHERE id=p_consumer_commitment_id;
  IF v_project_id IS NULL OR NOT goliath_api.context_allows_project(p_assignment_id,v_project_id) THEN
    RAISE EXCEPTION 'Consumer commitment is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF p_provider_type NOT IN ('commitment','person','team','party') THEN
    RAISE EXCEPTION 'Unsupported dependency provider type.' USING ERRCODE='22023';
  END IF;
  IF COALESCE(trim(p_provider_ref),'')='' OR COALESCE(trim(p_needed_by),'')='' OR length(trim(COALESCE(p_acceptance_criteria,'')))<5 THEN
    RAISE EXCEPTION 'Provider, needed-by date and meaningful acceptance criteria are required.' USING ERRCODE='22023';
  END IF;
  IF p_provider_type='commitment' THEN
    IF p_provider_commitment_id IS NULL OR p_provider_ref<>p_provider_commitment_id OR NOT EXISTS(SELECT 1 FROM public.pc_commitments WHERE id=p_provider_commitment_id) THEN
      RAISE EXCEPTION 'A valid provider commitment is required.' USING ERRCODE='22023';
    END IF;
    IF p_provider_commitment_id=p_consumer_commitment_id THEN
      RAISE EXCEPTION 'A commitment cannot depend on itself.' USING ERRCODE='22023';
    END IF;
  END IF;

  INSERT INTO public.pc_commitment_dependencies(
    project_id,consumer_commitment_id,provider_type,provider_ref,provider_commitment_id,
    needed_by,acceptance_criteria,state,origin,created_by,created_at,updated_at
  ) VALUES(
    v_project_id,p_consumer_commitment_id,p_provider_type,p_provider_ref,p_provider_commitment_id,
    p_needed_by,trim(p_acceptance_criteria),'proposed','human',c->>'userId',now()::text,now()::text
  ) RETURNING id INTO v_id;

  PERFORM goliath_api.append_project_event(
    v_project_id,c->>'userId','dependency.created','dependency',v_id,'recorded',
    'Two-party dependency created; acknowledgement still required.',NULL,1,
    jsonb_build_object('consumerCommitmentId',p_consumer_commitment_id,'providerType',p_provider_type,'providerRef',p_provider_ref,'neededBy',p_needed_by)
  );

  RETURN jsonb_build_object('dependencyId',v_id,'projectId',v_project_id,'state','proposed');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.acknowledge_commitment_dependency(
  p_assignment_id text,
  p_dependency_id text,
  p_side text,
  p_promised_date text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  d public.pc_commitment_dependencies%ROWTYPE;
  consumer public.pc_commitments%ROWTYPE;
  provider public.pc_commitments%ROWTYPE;
  v_user text;
  v_state text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_user:=c->>'userId';
  SELECT * INTO d FROM public.pc_commitment_dependencies WHERE id=p_dependency_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dependency not found.' USING ERRCODE='22023'; END IF;
  SELECT * INTO consumer FROM public.pc_commitments WHERE id=d.consumer_commitment_id;
  IF d.provider_commitment_id IS NOT NULL THEN SELECT * INTO provider FROM public.pc_commitments WHERE id=d.provider_commitment_id; END IF;

  IF NOT (goliath_api.context_allows_project(p_assignment_id,d.project_id) OR (provider.project_id IS NOT NULL AND goliath_api.context_allows_project(p_assignment_id,provider.project_id))) THEN
    RAISE EXCEPTION 'Dependency is outside this responsibility context.' USING ERRCODE='42501';
  END IF;

  IF p_side='consumer' THEN
    IF consumer.accountable_owner_id<>v_user THEN
      RAISE EXCEPTION 'Only the accountable consumer may acknowledge this dependency.' USING ERRCODE='42501';
    END IF;
    UPDATE public.pc_commitment_dependencies
      SET consumer_acknowledged_by=v_user,consumer_acknowledged_at=now()::text,
          current_reason=COALESCE(NULLIF(trim(p_reason),''),current_reason),updated_at=now()::text,revision=revision+1
      WHERE id=d.id;
  ELSIF p_side='provider' THEN
    IF NOT ((d.provider_type='person' AND d.provider_ref=v_user) OR (d.provider_type='commitment' AND provider.accountable_owner_id=v_user)) THEN
      RAISE EXCEPTION 'Only the named provider or provider-commitment owner may acknowledge.' USING ERRCODE='42501';
    END IF;
    IF COALESCE(trim(p_promised_date),'')='' THEN
      RAISE EXCEPTION 'Provider promised date is required.' USING ERRCODE='22023';
    END IF;
    UPDATE public.pc_commitment_dependencies
      SET provider_acknowledged_by=v_user,provider_acknowledged_at=now()::text,promised_date=p_promised_date,
          current_reason=COALESCE(NULLIF(trim(p_reason),''),current_reason),updated_at=now()::text,revision=revision+1
      WHERE id=d.id;
  ELSE
    RAISE EXCEPTION 'Acknowledgement side must be provider or consumer.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO d FROM public.pc_commitment_dependencies WHERE id=p_dependency_id;
  v_state := CASE
    WHEN d.provider_acknowledged_at IS NOT NULL AND d.consumer_acknowledged_at IS NOT NULL AND d.promised_date>d.needed_by THEN 'at-risk'
    WHEN d.provider_acknowledged_at IS NOT NULL AND d.consumer_acknowledged_at IS NOT NULL THEN 'acknowledged'
    ELSE 'proposed'
  END;
  UPDATE public.pc_commitment_dependencies SET state=v_state,revision=revision+1,updated_at=now()::text WHERE id=d.id AND state<>v_state;

  PERFORM goliath_api.append_project_event(
    d.project_id,v_user,'dependency.acknowledged','dependency',d.id,'recorded',
    COALESCE(NULLIF(trim(p_reason),''),'Dependency acknowledgement recorded.'),d.revision,d.revision+1,
    jsonb_build_object('side',p_side,'promisedDate',p_promised_date,'state',v_state)
  );

  RETURN jsonb_build_object('dependencyId',d.id,'state',v_state,'side',p_side);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.dependency_queue(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  v_user text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_user:=c->>'userId';
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',d.id,'projectId',d.project_id,'consumerCommitmentId',d.consumer_commitment_id,
      'consumerTitle',consumer.title,'providerType',d.provider_type,'providerRef',d.provider_ref,
      'providerCommitmentId',d.provider_commitment_id,'providerTitle',provider.title,
      'neededBy',d.needed_by,'promisedDate',d.promised_date,'acceptanceCriteria',d.acceptance_criteria,
      'state',d.state,'reason',d.current_reason,'providerAcknowledgedAt',d.provider_acknowledged_at,
      'consumerAcknowledgedAt',d.consumer_acknowledged_at,
      'canAcknowledgeConsumer',(consumer.accountable_owner_id=v_user AND d.consumer_acknowledged_at IS NULL),
      'canAcknowledgeProvider',(((d.provider_type='person' AND d.provider_ref=v_user) OR (d.provider_type='commitment' AND provider.accountable_owner_id=v_user)) AND d.provider_acknowledged_at IS NULL),
      'revision',d.revision
    ) ORDER BY d.needed_by,d.id)
    FROM public.pc_commitment_dependencies d
    JOIN public.pc_commitments consumer ON consumer.id=d.consumer_commitment_id
    LEFT JOIN public.pc_commitments provider ON provider.id=d.provider_commitment_id
    WHERE goliath_api.context_allows_project(p_assignment_id,d.project_id)
       OR (provider.project_id IS NOT NULL AND goliath_api.context_allows_project(p_assignment_id,provider.project_id))
  ),'[]'::jsonb);
END
$$;

REVOKE ALL ON TABLE public.pc_decision_commitments, public.pc_commitment_dependencies FROM PUBLIC, anonymous, authenticated, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.create_decision(text,text,text,text,text,text,integer,jsonb,text,text,jsonb), goliath_api.delegate_decision(text,text,text,text), goliath_api.decision_queue(text), goliath_api.resolve_decision(text,text,text,text,text), goliath_api.decision_debt_summary(text), goliath_api.create_commitment_dependency(text,text,text,text,text,text,text), goliath_api.acknowledge_commitment_dependency(text,text,text,text,text), goliath_api.dependency_queue(text) FROM PUBLIC, anonymous, goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.create_decision(text,text,text,text,text,text,integer,jsonb,text,text,jsonb), goliath_api.delegate_decision(text,text,text,text), goliath_api.decision_queue(text), goliath_api.resolve_decision(text,text,text,text,text), goliath_api.decision_debt_summary(text), goliath_api.create_commitment_dependency(text,text,text,text,text,text,text), goliath_api.acknowledge_commitment_dependency(text,text,text,text,text), goliath_api.dependency_queue(text) TO authenticated;

COMMIT;

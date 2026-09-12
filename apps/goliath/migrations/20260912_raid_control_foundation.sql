-- Goliath linked RAID control foundation
-- Date: 2026-09-12
-- Purpose: risks/issues/assumptions as live management objects linked to commitments.
-- Human scoring remains authoritative; watched deterministic triggers create issue candidates, not automatic issues.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pc_raid_items (
  id text PRIMARY KEY DEFAULT ('raid-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('risk','issue','assumption')),
  title text NOT NULL,
  description text NOT NULL,
  owner_id text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','monitoring','responding','accepted','resolved','closed','invalidated')),
  likelihood_rating integer CHECK (likelihood_rating BETWEEN 1 AND 5),
  impact_rating integer CHECK (impact_rating BETWEEN 1 AND 5),
  exposure_score integer,
  response text,
  trigger_type text CHECK (trigger_type IN ('dependency-late','decision-overdue','assumption-validation-date','manual')),
  trigger_ref text,
  validation_date text,
  validation_evidence_refs_json text NOT NULL DEFAULT '[]',
  source_origin text NOT NULL DEFAULT 'human' CHECK (source_origin IN ('human','external-source','ai-proposed','ai-confirmed','system-trigger')),
  created_by text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  CHECK (item_type='risk' OR likelihood_rating IS NULL),
  CHECK (item_type<>'risk' OR exposure_score IS NULL OR exposure_score=likelihood_rating*impact_rating),
  CHECK (item_type<>'assumption' OR validation_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pc_raid_project_state
  ON public.pc_raid_items(project_id,item_type,state,owner_id);
CREATE INDEX IF NOT EXISTS idx_pc_raid_trigger
  ON public.pc_raid_items(project_id,trigger_type,trigger_ref,state);

CREATE TABLE IF NOT EXISTS public.pc_raid_commitments (
  raid_id text NOT NULL REFERENCES public.pc_raid_items(id) ON DELETE CASCADE,
  commitment_id text NOT NULL REFERENCES public.pc_commitments(id) ON DELETE CASCADE,
  PRIMARY KEY(raid_id,commitment_id)
);

CREATE TABLE IF NOT EXISTS public.pc_raid_trigger_events (
  id text PRIMARY KEY DEFAULT ('rtg-'||gen_random_uuid()::text),
  raid_id text NOT NULL REFERENCES public.pc_raid_items(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  observed_at text NOT NULL,
  trigger_type text NOT NULL,
  trigger_ref text,
  evidence_json text NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate','converted','dismissed')),
  resolved_by text,
  resolved_at text,
  reason text,
  issue_id text REFERENCES public.pc_raid_items(id),
  UNIQUE(raid_id,trigger_type,trigger_ref,state)
);

CREATE INDEX IF NOT EXISTS idx_pc_raid_trigger_events_project_state
  ON public.pc_raid_trigger_events(project_id,state,observed_at DESC);

CREATE OR REPLACE FUNCTION goliath_api.create_raid_item(
  p_assignment_id text,
  p_project_id text,
  p_item_type text,
  p_title text,
  p_description text,
  p_owner_id text,
  p_likelihood_rating integer DEFAULT NULL,
  p_impact_rating integer DEFAULT NULL,
  p_response text DEFAULT NULL,
  p_trigger_type text DEFAULT NULL,
  p_trigger_ref text DEFAULT NULL,
  p_validation_date text DEFAULT NULL,
  p_commitment_ids jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_role text; v_id text; cm text; v_exposure integer;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id); v_role:=ctx->>'role';
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  IF p_item_type NOT IN ('risk','issue','assumption') THEN RAISE EXCEPTION 'RAID type must be risk, issue or assumption.' USING ERRCODE='22023'; END IF;
  IF p_item_type IN ('risk','assumption') AND v_role NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'This responsibility cannot register risks or assumptions.' USING ERRCODE='42501'; END IF;
  IF COALESCE(length(trim(p_title)),0)<3 OR COALESCE(length(trim(p_description)),0)<5 THEN RAISE EXCEPTION 'Meaningful title and description are required.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pc_project_members WHERE project_id=p_project_id AND user_id=p_owner_id AND active=1) THEN RAISE EXCEPTION 'RAID owner must be an active governed project member.' USING ERRCODE='22023'; END IF;
  IF p_item_type='risk' THEN
    IF p_likelihood_rating IS NULL OR p_impact_rating IS NULL OR p_likelihood_rating NOT BETWEEN 1 AND 5 OR p_impact_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Risk likelihood and impact must be human-scored from 1 to 5.' USING ERRCODE='22023'; END IF;
    v_exposure:=p_likelihood_rating*p_impact_rating;
  ELSIF p_item_type='assumption' AND p_validation_date IS NULL THEN
    RAISE EXCEPTION 'Assumption validation date is required.' USING ERRCODE='22023';
  END IF;
  IF p_trigger_type IS NOT NULL AND p_trigger_type NOT IN ('dependency-late','decision-overdue','assumption-validation-date','manual') THEN RAISE EXCEPTION 'Unsupported watched trigger.' USING ERRCODE='22023'; END IF;
  IF p_trigger_type IN ('dependency-late','decision-overdue') AND COALESCE(trim(p_trigger_ref),'')='' THEN RAISE EXCEPTION 'Watched dependency/decision trigger requires a governed reference.' USING ERRCODE='22023'; END IF;

  INSERT INTO public.pc_raid_items(project_id,item_type,title,description,owner_id,state,likelihood_rating,impact_rating,exposure_score,response,trigger_type,trigger_ref,validation_date,source_origin,created_by,created_at,updated_at)
  VALUES(p_project_id,p_item_type,trim(p_title),trim(p_description),p_owner_id,CASE WHEN p_item_type='risk' THEN 'monitoring' ELSE 'open' END,p_likelihood_rating,p_impact_rating,v_exposure,NULLIF(trim(p_response),''),p_trigger_type,p_trigger_ref,p_validation_date,'human',ctx->>'userId',now()::text,now()::text)
  RETURNING id INTO v_id;

  FOR cm IN SELECT jsonb_array_elements_text(COALESCE(p_commitment_ids,'[]'::jsonb)) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.pc_commitments WHERE id=cm AND project_id=p_project_id) THEN RAISE EXCEPTION 'Linked commitment % is outside the project.',cm USING ERRCODE='22023'; END IF;
    INSERT INTO public.pc_raid_commitments(raid_id,commitment_id) VALUES(v_id,cm) ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','raid.'||p_item_type||'.created',p_item_type,v_id,'recorded','RAID item registered by a named human.',NULL,1,jsonb_build_object('ownerId',p_owner_id,'exposure',v_exposure,'triggerType',p_trigger_type,'triggerRef',p_trigger_ref));
  RETURN jsonb_build_object('raidId',v_id,'type',p_item_type,'state',CASE WHEN p_item_type='risk' THEN 'monitoring' ELSE 'open' END,'exposure',v_exposure);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.raid_board(
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
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Delivery read authority required.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'type',r.item_type,'title',r.title,'description',r.description,'ownerId',r.owner_id,
      'state',r.state,'likelihood',r.likelihood_rating,'impact',r.impact_rating,'exposure',r.exposure_score,
      'response',r.response,'triggerType',r.trigger_type,'triggerRef',r.trigger_ref,'validationDate',r.validation_date,
      'origin',r.source_origin,'revision',r.revision,
      'commitments',COALESCE((SELECT jsonb_agg(rc.commitment_id ORDER BY rc.commitment_id) FROM public.pc_raid_commitments rc WHERE rc.raid_id=r.id),'[]'::jsonb)
    ) ORDER BY CASE r.item_type WHEN 'issue' THEN 1 WHEN 'risk' THEN 2 ELSE 3 END,r.exposure_score DESC NULLS LAST,r.updated_at DESC)
    FROM public.pc_raid_items r WHERE r.project_id=p_project_id AND r.state NOT IN ('closed','resolved')),'[]'::jsonb),
    'triggerCandidates',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',e.id,'raidId',e.raid_id,'triggerType',e.trigger_type,'triggerRef',e.trigger_ref,'observedAt',e.observed_at,'evidence',e.evidence_json::jsonb,'state',e.state
    ) ORDER BY e.observed_at DESC) FROM public.pc_raid_trigger_events e WHERE e.project_id=p_project_id AND e.state='candidate'),'[]'::jsonb)
  );
END
$$;

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
      VALUES(r.id,p_project_id,now()::text,r.trigger_type,r.trigger_ref, v_evidence::text,'candidate')
      ON CONFLICT (raid_id,trigger_type,trigger_ref,state) DO NOTHING;
      IF FOUND THEN v_fired:=v_fired+1; END IF;
    END IF;
  END LOOP;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','raid.triggers.evaluated','raid-trigger-run',gen_random_uuid()::text,'recorded','Deterministic RAID watched triggers evaluated.',NULL,NULL,jsonb_build_object('candidateCount',v_fired));
  RETURN jsonb_build_object('projectId',p_project_id,'newIssueCandidates',v_fired);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.convert_raid_trigger_to_issue(
  p_assignment_id text,
  p_trigger_event_id text,
  p_owner_id text,
  p_description text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; ev public.pc_raid_trigger_events%ROWTYPE; src public.pc_raid_items%ROWTYPE; v_issue text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  SELECT * INTO ev FROM public.pc_raid_trigger_events WHERE id=p_trigger_event_id FOR UPDATE;
  IF NOT FOUND OR ev.state<>'candidate' OR NOT goliath_api.context_allows_project(p_assignment_id,ev.project_id) THEN RAISE EXCEPTION 'RAID trigger candidate is not available.' USING ERRCODE='42501'; END IF;
  IF ctx->>'role' NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'Human management authority is required to convert a trigger into an issue.' USING ERRCODE='42501'; END IF;
  IF COALESCE(length(trim(p_reason)),0)<5 THEN RAISE EXCEPTION 'Conversion rationale is required.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pc_project_members WHERE project_id=ev.project_id AND user_id=p_owner_id AND active=1) THEN RAISE EXCEPTION 'Issue owner must be an active governed project member.' USING ERRCODE='22023'; END IF;
  SELECT * INTO src FROM public.pc_raid_items WHERE id=ev.raid_id;
  INSERT INTO public.pc_raid_items(project_id,item_type,title,description,owner_id,state,impact_rating,response,source_origin,created_by,created_at,updated_at)
  VALUES(ev.project_id,'issue','Triggered: '||src.title,COALESCE(NULLIF(trim(p_description),''),src.description),p_owner_id,'open',src.impact_rating,src.response,'system-trigger',ctx->>'userId',now()::text,now()::text)
  RETURNING id INTO v_issue;
  INSERT INTO public.pc_raid_commitments(raid_id,commitment_id) SELECT v_issue,commitment_id FROM public.pc_raid_commitments WHERE raid_id=src.id ON CONFLICT DO NOTHING;
  UPDATE public.pc_raid_trigger_events SET state='converted',resolved_by=ctx->>'userId',resolved_at=now()::text,reason=trim(p_reason),issue_id=v_issue WHERE id=ev.id;
  PERFORM goliath_api.append_project_event(ev.project_id,ctx->>'userId','raid.trigger.converted','issue',v_issue,'recorded',trim(p_reason),NULL,1,jsonb_build_object('sourceRaidId',src.id,'triggerEventId',ev.id));
  RETURN jsonb_build_object('issueId',v_issue,'sourceRaidId',src.id,'triggerEventId',ev.id);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.update_raid_item(
  p_assignment_id text,
  p_raid_id text,
  p_state text,
  p_response text,
  p_likelihood_rating integer DEFAULT NULL,
  p_impact_rating integer DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; r public.pc_raid_items%ROWTYPE; v_exposure integer;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  SELECT * INTO r FROM public.pc_raid_items WHERE id=p_raid_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,r.project_id) THEN RAISE EXCEPTION 'RAID item is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT (r.owner_id=ctx->>'userId' OR ctx->>'role' IN ('project-manager','project-director','program-manager','pmo')) THEN RAISE EXCEPTION 'RAID owner or management responsibility required.' USING ERRCODE='42501'; END IF;
  IF p_state NOT IN ('open','monitoring','responding','accepted','resolved','closed','invalidated') THEN RAISE EXCEPTION 'Unsupported RAID state.' USING ERRCODE='22023'; END IF;
  IF p_state IN ('accepted','resolved','closed','invalidated') AND COALESCE(length(trim(p_reason)),0)<5 THEN RAISE EXCEPTION 'Closing/accepting a RAID item requires rationale.' USING ERRCODE='22023'; END IF;
  IF r.item_type='risk' THEN
    IF p_likelihood_rating IS NULL OR p_impact_rating IS NULL OR p_likelihood_rating NOT BETWEEN 1 AND 5 OR p_impact_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Risk likelihood and impact require human scores from 1 to 5.' USING ERRCODE='22023'; END IF;
    v_exposure:=p_likelihood_rating*p_impact_rating;
  END IF;
  UPDATE public.pc_raid_items SET state=p_state,response=NULLIF(trim(p_response),''),likelihood_rating=CASE WHEN item_type='risk' THEN p_likelihood_rating ELSE likelihood_rating END,impact_rating=COALESCE(p_impact_rating,impact_rating),exposure_score=CASE WHEN item_type='risk' THEN v_exposure ELSE exposure_score END,updated_at=now()::text,revision=revision+1 WHERE id=r.id;
  PERFORM goliath_api.append_project_event(r.project_id,ctx->>'userId','raid.updated',r.item_type,r.id,'recorded',COALESCE(NULLIF(trim(p_reason),''),'RAID response/state updated.'),r.revision,r.revision+1,jsonb_build_object('state',p_state,'exposure',v_exposure));
  RETURN jsonb_build_object('raidId',r.id,'state',p_state,'exposure',v_exposure);
END
$$;

REVOKE ALL ON FUNCTION goliath_api.create_raid_item(text,text,text,text,text,text,integer,integer,text,text,text,text,jsonb) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.raid_board(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.evaluate_raid_triggers(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.convert_raid_trigger_to_issue(text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.update_raid_item(text,text,text,text,integer,integer,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.create_raid_item(text,text,text,text,text,text,integer,integer,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.raid_board(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.evaluate_raid_triggers(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.convert_raid_trigger_to_issue(text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.update_raid_item(text,text,text,text,integer,integer,text) TO authenticated;

COMMIT;

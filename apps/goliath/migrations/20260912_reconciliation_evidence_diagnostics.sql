-- Reconciliation ambiguity handling and evidence-gap diagnostics.
-- Reuses integration_bindings_v2, integration_inbox_v2, external_object_links_v2,
-- pc_commitments and pc_evidence_links. It does not introduce a second connector framework.

CREATE TABLE IF NOT EXISTS public.integration_reconciliation_issues_v2 (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organisation_id text NOT NULL,
  project_id text NOT NULL,
  binding_id text NOT NULL REFERENCES public.integration_bindings_v2(id),
  inbox_id text REFERENCES public.integration_inbox_v2(id),
  issue_type text NOT NULL CHECK (issue_type IN ('unmapped-object','ambiguous-match','schema-drift','field-conflict','provider-error','auth-error','duplicate','stale-source','other')),
  severity text NOT NULL CHECK (severity IN ('info','attention','high','critical')),
  summary text NOT NULL,
  details_json text NOT NULL DEFAULT '{}',
  candidate_matches_json text NOT NULL DEFAULT '[]',
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','acknowledged','resolved','dismissed')),
  detected_at text NOT NULL,
  acknowledged_by text,
  acknowledged_at text,
  resolved_by text,
  resolved_at text,
  resolution text,
  revision integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_integration_reconciliation_project_state
  ON public.integration_reconciliation_issues_v2(project_id,state,severity);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_reconciliation_open_inbox_type
  ON public.integration_reconciliation_issues_v2(inbox_id,issue_type)
  WHERE inbox_id IS NOT NULL AND state IN ('open','acknowledged');

REVOKE ALL ON public.integration_reconciliation_issues_v2 FROM PUBLIC;
REVOKE ALL ON public.integration_reconciliation_issues_v2 FROM authenticated;
REVOKE ALL ON public.integration_reconciliation_issues_v2 FROM goliath_web_anon;

CREATE OR REPLACE FUNCTION goliath_api.integration_reconciliation_queue(p_assignment_id text,p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE
  ctx jsonb;
  v_role text;
  v_can_detail boolean;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  v_role:=ctx->>'role';
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501';
  END IF;
  IF v_role NOT IN ('enterprise-admin','pmo','project-manager','project-director','program-manager') THEN
    RAISE EXCEPTION 'This responsibility does not receive reconciliation diagnostics.' USING ERRCODE='42501';
  END IF;
  IF v_role='enterprise-admin' THEN
    IF NOT goliath_api.context_has_data_class(p_assignment_id,'audit','read') THEN
      RAISE EXCEPTION 'Audit read authority required.' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN
      RAISE EXCEPTION 'Delivery read authority required.' USING ERRCODE='42501';
    END IF;
  END IF;
  v_can_detail:=v_role IN ('enterprise-admin','pmo');

  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'issues',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',r.id,
        'bindingId',r.binding_id,
        'inboxId',r.inbox_id,
        'issueType',r.issue_type,
        'severity',r.severity,
        'summary',r.summary,
        'details',CASE WHEN v_can_detail THEN r.details_json::jsonb ELSE '{}'::jsonb END,
        'candidateMatches',CASE WHEN v_can_detail THEN r.candidate_matches_json::jsonb ELSE '[]'::jsonb END,
        'state',r.state,
        'detectedAt',r.detected_at,
        'acknowledgedAt',r.acknowledged_at,
        'resolvedAt',r.resolved_at,
        'resolution',CASE WHEN v_can_detail THEN r.resolution ELSE NULL END,
        'revision',r.revision,
        'provider',b.provider,
        'domain',b.domain,
        'environment',b.environment
      ) ORDER BY CASE r.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'attention' THEN 2 ELSE 1 END DESC,r.detected_at DESC)
      FROM public.integration_reconciliation_issues_v2 r
      JOIN public.integration_bindings_v2 b ON b.id=r.binding_id
      WHERE r.project_id=p_project_id AND r.state IN ('open','acknowledged')
    ),'[]'::jsonb),
    'unaccountedInbox',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',i.id,'bindingId',i.binding_id,'providerEventId',i.provider_event_id,
        'resourceType',i.provider_resource_type,'state',i.state,'observedAt',i.observed_at,
        'attemptCount',i.attempt_count,'hasError',i.last_error IS NOT NULL,
        'nextAttemptAt',i.next_attempt_at,'provider',b.provider,'domain',b.domain
      ) ORDER BY i.observed_at DESC)
      FROM public.integration_inbox_v2 i
      JOIN public.integration_bindings_v2 b ON b.id=i.binding_id
      WHERE i.project_id=p_project_id
        AND i.processed_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.integration_reconciliation_issues_v2 r WHERE r.inbox_id=i.id AND r.state IN ('open','acknowledged'))
    ),'[]'::jsonb),
    'summary',jsonb_build_object(
      'openIssues',(SELECT count(*) FROM public.integration_reconciliation_issues_v2 r WHERE r.project_id=p_project_id AND r.state IN ('open','acknowledged')),
      'criticalIssues',(SELECT count(*) FROM public.integration_reconciliation_issues_v2 r WHERE r.project_id=p_project_id AND r.state IN ('open','acknowledged') AND r.severity='critical'),
      'ambiguousMatches',(SELECT count(*) FROM public.integration_reconciliation_issues_v2 r WHERE r.project_id=p_project_id AND r.state IN ('open','acknowledged') AND r.issue_type='ambiguous-match'),
      'unmappedObjects',(SELECT count(*) FROM public.integration_reconciliation_issues_v2 r WHERE r.project_id=p_project_id AND r.state IN ('open','acknowledged') AND r.issue_type='unmapped-object'),
      'unaccountedInbox',(SELECT count(*) FROM public.integration_inbox_v2 i WHERE i.project_id=p_project_id AND i.processed_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.integration_reconciliation_issues_v2 r WHERE r.inbox_id=i.id AND r.state IN ('open','acknowledged')))
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.integration_reconciliation_queue(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.integration_reconciliation_queue(text,text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.integration_reconciliation_queue(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION goliath_api.create_reconciliation_issue(
  p_assignment_id text,p_project_id text,p_binding_id text,p_inbox_id text,p_issue_type text,p_severity text,
  p_summary text,p_details jsonb DEFAULT '{}'::jsonb,p_candidate_matches jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE
  ctx jsonb;
  v_id text;
  v_org text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role'<>'pmo' THEN
    RAISE EXCEPTION 'PMO responsibility is required to register reconciliation ambiguity.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) OR NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN
    RAISE EXCEPTION 'Project delivery write authority required.' USING ERRCODE='42501';
  END IF;
  IF p_issue_type NOT IN ('unmapped-object','ambiguous-match','schema-drift','field-conflict','provider-error','auth-error','duplicate','stale-source','other') THEN
    RAISE EXCEPTION 'Unsupported reconciliation issue type.' USING ERRCODE='22023';
  END IF;
  IF p_severity NOT IN ('info','attention','high','critical') THEN
    RAISE EXCEPTION 'Unsupported reconciliation severity.' USING ERRCODE='22023';
  END IF;
  IF COALESCE(length(trim(p_summary)),0)<5 THEN
    RAISE EXCEPTION 'Meaningful reconciliation summary is required.' USING ERRCODE='22023';
  END IF;
  SELECT organisation_id INTO v_org FROM public.integration_bindings_v2 WHERE id=p_binding_id AND project_id=p_project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Binding is outside this project.' USING ERRCODE='22023';
  END IF;
  IF p_inbox_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.integration_inbox_v2 i WHERE i.id=p_inbox_id AND i.binding_id=p_binding_id AND i.project_id=p_project_id) THEN
    RAISE EXCEPTION 'Inbox record is outside the selected binding/project.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.integration_reconciliation_issues_v2(
    organisation_id,project_id,binding_id,inbox_id,issue_type,severity,summary,details_json,candidate_matches_json,state,detected_at)
  VALUES(v_org,p_project_id,p_binding_id,p_inbox_id,p_issue_type,p_severity,trim(p_summary),COALESCE(p_details,'{}'::jsonb)::text,COALESCE(p_candidate_matches,'[]'::jsonb)::text,'open',now()::text)
  RETURNING id INTO v_id;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','integration.reconciliation.issue.created','integration-reconciliation',v_id,'recorded',trim(p_summary),NULL,1,jsonb_build_object('bindingId',p_binding_id,'inboxId',p_inbox_id,'issueType',p_issue_type,'severity',p_severity));
  RETURN jsonb_build_object('issueId',v_id,'state','open');
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.create_reconciliation_issue(text,text,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.create_reconciliation_issue(text,text,text,text,text,text,text,jsonb,jsonb) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.create_reconciliation_issue(text,text,text,text,text,text,text,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION goliath_api.respond_reconciliation_issue(p_assignment_id text,p_issue_id text,p_action text,p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE
  ctx jsonb;
  r public.integration_reconciliation_issues_v2%ROWTYPE;
  v_state text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role'<>'pmo' THEN
    RAISE EXCEPTION 'PMO responsibility is required to resolve reconciliation ambiguity.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM public.integration_reconciliation_issues_v2 WHERE id=p_issue_id FOR UPDATE;
  IF NOT FOUND OR NOT goliath_api.context_allows_project(p_assignment_id,r.project_id) OR NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN
    RAISE EXCEPTION 'Reconciliation issue is outside this responsibility.' USING ERRCODE='42501';
  END IF;
  IF p_action NOT IN ('acknowledge','resolve','dismiss') THEN
    RAISE EXCEPTION 'Unsupported reconciliation response.' USING ERRCODE='22023';
  END IF;
  IF COALESCE(length(trim(p_reason)),0)<5 THEN
    RAISE EXCEPTION 'Reconciliation response reason is required.' USING ERRCODE='22023';
  END IF;
  v_state:=CASE p_action WHEN 'acknowledge' THEN 'acknowledged' WHEN 'resolve' THEN 'resolved' ELSE 'dismissed' END;
  UPDATE public.integration_reconciliation_issues_v2 SET
    state=v_state,
    acknowledged_by=CASE WHEN p_action='acknowledge' THEN ctx->>'userId' ELSE acknowledged_by END,
    acknowledged_at=CASE WHEN p_action='acknowledge' THEN now()::text ELSE acknowledged_at END,
    resolved_by=CASE WHEN p_action IN ('resolve','dismiss') THEN ctx->>'userId' ELSE resolved_by END,
    resolved_at=CASE WHEN p_action IN ('resolve','dismiss') THEN now()::text ELSE resolved_at END,
    resolution=CASE WHEN p_action IN ('resolve','dismiss') THEN trim(p_reason) ELSE resolution END,
    revision=revision+1
  WHERE id=r.id;
  PERFORM goliath_api.append_project_event(r.project_id,ctx->>'userId','integration.reconciliation.issue.'||p_action,'integration-reconciliation',r.id,'recorded',trim(p_reason),r.revision,r.revision+1,jsonb_build_object('issueType',r.issue_type,'bindingId',r.binding_id));
  RETURN jsonb_build_object('issueId',r.id,'state',v_state);
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.respond_reconciliation_issue(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.respond_reconciliation_issue(text,text,text,text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.respond_reconciliation_issue(text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION goliath_api.evidence_gap_diagnostics(p_assignment_id text,p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE
  ctx jsonb;
  v_role text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  v_role:=ctx->>'role';
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) OR NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN
    RAISE EXCEPTION 'Project delivery read authority required.' USING ERRCODE='42501';
  END IF;
  IF v_role NOT IN ('pmo','project-manager','project-director','program-manager') THEN
    RAISE EXCEPTION 'This responsibility does not receive evidence-gap diagnostics.' USING ERRCODE='42501';
  END IF;

  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'commitments',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'commitmentId',c.id,'title',c.title,'state',c.state,'ownerId',c.accountable_owner_id,
        'requiredKinds',c.evidence_spec_json::jsonb,
        'requiredCount',jsonb_array_length(c.evidence_spec_json::jsonb),
        'visibleEvidenceCount',(SELECT count(*) FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')),
        'restrictedEvidenceCount',(SELECT count(*) FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND NOT goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')),
        'presentKinds',COALESCE((SELECT jsonb_agg(DISTINCT e.evidence_kind ORDER BY e.evidence_kind) FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')),'[]'::jsonb),
        'missingKinds',COALESCE((SELECT jsonb_agg(req.kind ORDER BY req.kind) FROM jsonb_array_elements_text(c.evidence_spec_json::jsonb) req(kind) WHERE NOT EXISTS(SELECT 1 FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND e.evidence_kind=req.kind AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read'))),'[]'::jsonb),
        'staleKinds',COALESCE((SELECT jsonb_agg(req.kind ORDER BY req.kind) FROM jsonb_array_elements_text(c.evidence_spec_json::jsonb) req(kind) WHERE EXISTS(SELECT 1 FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND e.evidence_kind=req.kind AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')) AND NOT EXISTS(SELECT 1 FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND e.evidence_kind=req.kind AND e.freshness_state='current' AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read'))),'[]'::jsonb),
        'coveragePercent',CASE WHEN jsonb_array_length(c.evidence_spec_json::jsonb)=0 THEN NULL ELSE round((100.0*(SELECT count(DISTINCT e.evidence_kind) FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND e.evidence_kind IN (SELECT jsonb_array_elements_text(c.evidence_spec_json::jsonb)) AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read'))/jsonb_array_length(c.evidence_spec_json::jsonb))::numeric,1) END,
        'currentCoveragePercent',CASE WHEN jsonb_array_length(c.evidence_spec_json::jsonb)=0 THEN NULL ELSE round((100.0*(SELECT count(DISTINCT e.evidence_kind) FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND e.freshness_state='current' AND e.evidence_kind IN (SELECT jsonb_array_elements_text(c.evidence_spec_json::jsonb)) AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read'))/jsonb_array_length(c.evidence_spec_json::jsonb))::numeric,1) END,
        'dataState',CASE WHEN jsonb_array_length(c.evidence_spec_json::jsonb)=0 THEN 'data-insufficient' WHEN EXISTS(SELECT 1 FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND NOT goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')) THEN 'partial' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.evidence_spec_json::jsonb) req(kind) WHERE NOT EXISTS(SELECT 1 FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND e.evidence_kind=req.kind AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read'))) THEN 'gaps' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.evidence_spec_json::jsonb) req(kind) WHERE NOT EXISTS(SELECT 1 FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND e.evidence_kind=req.kind AND e.freshness_state='current' AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read'))) THEN 'stale' ELSE 'complete-current' END,
        'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.evidence_kind,'sourceSystem',e.source_system,'sourceObjectType',e.source_object_type,'sourceObjectId',e.source_object_id,'ownerSystem',e.owner_system,'sourceVersion',e.source_version,'sourceUpdatedAt',e.source_updated_at,'ingestedAt',e.ingested_at,'lastReconciledAt',e.last_reconciled_at,'freshness',e.freshness_state,'classification',e.classification,'origin',e.origin) ORDER BY e.evidence_kind,e.source_system,e.source_object_id) FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')),'[]'::jsonb)
      ) ORDER BY c.committed_date NULLS LAST,c.id)
      FROM public.pc_commitments c
      WHERE c.project_id=p_project_id AND c.state NOT IN ('proposed','cancelled','waived','closed')
    ),'[]'::jsonb),
    'summary',jsonb_build_object(
      'controlledCommitments',(SELECT count(*) FROM public.pc_commitments c WHERE c.project_id=p_project_id AND c.state NOT IN ('proposed','cancelled','waived','closed')),
      'withoutEvidenceSpec',(SELECT count(*) FROM public.pc_commitments c WHERE c.project_id=p_project_id AND c.state NOT IN ('proposed','cancelled','waived','closed') AND jsonb_array_length(c.evidence_spec_json::jsonb)=0),
      'withAnyEvidence',(SELECT count(DISTINCT c.id) FROM public.pc_commitments c JOIN public.pc_evidence_links e ON e.commitment_id=c.id AND e.lifecycle_state='active' WHERE c.project_id=p_project_id AND c.state NOT IN ('proposed','cancelled','waived','closed')),
      'staleEvidenceRows',(SELECT count(*) FROM public.pc_evidence_links e WHERE e.project_id=p_project_id AND e.lifecycle_state='active' AND e.freshness_state<>'current')
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.evidence_gap_diagnostics(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.evidence_gap_diagnostics(text,text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.evidence_gap_diagnostics(text,text) TO authenticated;

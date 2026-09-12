-- Goliath integration health and outcome instrumentation
-- Date: 2026-09-12
-- Purpose: reuse existing connector/inbox/source structures to expose PMO integration health,
-- and measure only outcomes currently supported by governed evidence.

BEGIN;

ALTER TABLE public.integration_bindings_v2
  ADD COLUMN IF NOT EXISTS reconciliation_sla_hours real NOT NULL DEFAULT 24 CHECK (reconciliation_sla_hours > 0),
  ADD COLUMN IF NOT EXISTS coverage_ceiling real CHECK (coverage_ceiling IS NULL OR (coverage_ceiling >= 0 AND coverage_ceiling <= 1)),
  ADD COLUMN IF NOT EXISTS last_successful_reconciliation_at text,
  ADD COLUMN IF NOT EXISTS health_note text;

CREATE OR REPLACE FUNCTION goliath_api.integration_health(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_role text; v_can_read boolean;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  v_role:=ctx->>'role';
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501';
  END IF;
  v_can_read:=CASE WHEN v_role='enterprise-admin' THEN goliath_api.context_has_data_class(p_assignment_id,'audit','read') ELSE goliath_api.context_has_data_class(p_assignment_id,'delivery','read') END;
  IF NOT v_can_read THEN RAISE EXCEPTION 'Integration health is not available to this responsibility.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('enterprise-admin','pmo','project-manager','project-director','program-manager') THEN
    RAISE EXCEPTION 'This responsibility does not receive integration-health diagnostics.' USING ERRCODE='42501';
  END IF;

  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'bindings',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',b.id,'domain',b.domain,'provider',b.provider,'environment',b.environment,'enabled',b.enabled=1,
      'authorityMode',b.authority_mode,'classification',b.classification,'version',b.version,
      'inboundFields',b.inbound_fields_json::jsonb,'outboundActions',b.outbound_actions_json::jsonb,
      'lastReconciledAt',b.last_reconciled_at,'lastSuccessfulAt',b.last_successful_reconciliation_at,
      'lastStatus',b.last_reconciliation_status,'slaHours',b.reconciliation_sla_hours,
      'coverageCeiling',b.coverage_ceiling,'healthNote',b.health_note,
      'health',CASE
        WHEN b.enabled=0 THEN 'disabled'
        WHEN b.last_reconciled_at IS NULL THEN 'unconfigured'
        WHEN lower(COALESCE(b.last_reconciliation_status,'')) NOT IN ('success','succeeded','ok','current','complete','completed') THEN 'error'
        WHEN now() - b.last_reconciled_at::timestamptz > make_interval(secs => (b.reconciliation_sla_hours*3600)::int) THEN 'stale'
        ELSE 'current' END,
      'inbox',jsonb_build_object(
        'total',(SELECT count(*) FROM public.integration_inbox_v2 i WHERE i.binding_id=b.id),
        'unprocessed',(SELECT count(*) FROM public.integration_inbox_v2 i WHERE i.binding_id=b.id AND i.processed_at IS NULL),
        'withError',(SELECT count(*) FROM public.integration_inbox_v2 i WHERE i.binding_id=b.id AND i.last_error IS NOT NULL),
        'retrying',(SELECT count(*) FROM public.integration_inbox_v2 i WHERE i.binding_id=b.id AND i.next_attempt_at IS NOT NULL AND i.processed_at IS NULL)
      ),
      'externalLinks',(SELECT count(*) FROM public.external_object_links_v2 l WHERE l.binding_id=b.id AND l.tombstoned_at IS NULL),
      'ownedFieldRules',(SELECT count(*) FROM public.pc_field_ownership_rules r WHERE r.active=1 AND lower(r.owner_system)=lower(b.provider))
    ) ORDER BY b.domain,b.provider,b.environment) FROM public.integration_bindings_v2 b WHERE b.project_id=p_project_id),'[]'::jsonb),
    'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'type',s.source_type,'ref',s.source_ref,'authority',s.authority,'status',s.status,
      'lastObservedAt',s.last_observed_at,'freshnessHours',s.freshness_hours,'classification',s.classification,
      'ageHours',CASE WHEN s.last_observed_at IS NULL THEN NULL ELSE round((extract(epoch FROM (now()-s.last_observed_at::timestamptz))/3600.0)::numeric,1) END
    ) ORDER BY s.id) FROM public.pc_sources s WHERE s.project_id=p_project_id),'[]'::jsonb),
    'fieldOwnership',goliath_api.field_ownership_catalog(p_assignment_id),
    'summary',jsonb_build_object(
      'enabledBindings',(SELECT count(*) FROM public.integration_bindings_v2 b WHERE b.project_id=p_project_id AND b.enabled=1),
      'staleOrFailedBindings',(SELECT count(*) FROM public.integration_bindings_v2 b WHERE b.project_id=p_project_id AND b.enabled=1 AND (b.last_reconciled_at IS NULL OR lower(COALESCE(b.last_reconciliation_status,'')) NOT IN ('success','succeeded','ok','current','complete','completed') OR now()-b.last_reconciled_at::timestamptz > make_interval(secs => (b.reconciliation_sla_hours*3600)::int))),
      'unprocessedInbox',(SELECT count(*) FROM public.integration_inbox_v2 i WHERE i.project_id=p_project_id AND i.processed_at IS NULL),
      'inboxErrors',(SELECT count(*) FROM public.integration_inbox_v2 i WHERE i.project_id=p_project_id AND i.last_error IS NOT NULL),
      'activeExternalLinks',(SELECT count(*) FROM public.external_object_links_v2 l WHERE l.project_id=p_project_id AND l.tombstoned_at IS NULL),
      'sourceRows',(SELECT count(*) FROM public.pc_sources s WHERE s.project_id=p_project_id),
      'staleSources',(SELECT count(*) FROM public.pc_sources s WHERE s.project_id=p_project_id AND s.status<>'current')
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.record_admin_effort_sample(
  p_assignment_id text,
  p_project_id text,
  p_period text,
  p_sample_type text,
  p_status_collection_minutes real,
  p_reconciliation_minutes real,
  p_chasing_minutes real,
  p_reporting_minutes real,
  p_duplicate_governance_minutes real,
  p_decision_preparation_minutes real
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_id text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role' NOT IN ('project-manager','project-director','program-manager','pmo') THEN RAISE EXCEPTION 'Management responsibility required to record administrative-effort samples.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN RAISE EXCEPTION 'Project is outside this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN RAISE EXCEPTION 'Delivery write authority required.' USING ERRCODE='42501'; END IF;
  IF p_sample_type NOT IN ('baseline','current') THEN RAISE EXCEPTION 'Sample type must be baseline or current.' USING ERRCODE='22023'; END IF;
  IF COALESCE(trim(p_period),'')='' THEN RAISE EXCEPTION 'Measurement period is required.' USING ERRCODE='22023'; END IF;
  IF LEAST(p_status_collection_minutes,p_reconciliation_minutes,p_chasing_minutes,p_reporting_minutes,p_duplicate_governance_minutes,p_decision_preparation_minutes)<0 THEN RAISE EXCEPTION 'Administrative-effort minutes cannot be negative.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.admin_effort_samples(id,project_id,period,sample_type,status_collection_minutes,reconciliation_minutes,chasing_minutes,reporting_minutes,duplicate_governance_minutes,decision_preparation_minutes,recorded_at)
  VALUES('eff-'||gen_random_uuid()::text,p_project_id,trim(p_period),p_sample_type,p_status_collection_minutes,p_reconciliation_minutes,p_chasing_minutes,p_reporting_minutes,p_duplicate_governance_minutes,p_decision_preparation_minutes,now()::text)
  ON CONFLICT(project_id,period,sample_type) DO UPDATE SET status_collection_minutes=EXCLUDED.status_collection_minutes,reconciliation_minutes=EXCLUDED.reconciliation_minutes,chasing_minutes=EXCLUDED.chasing_minutes,reporting_minutes=EXCLUDED.reporting_minutes,duplicate_governance_minutes=EXCLUDED.duplicate_governance_minutes,decision_preparation_minutes=EXCLUDED.decision_preparation_minutes,recorded_at=EXCLUDED.recorded_at
  RETURNING id INTO v_id;
  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','outcome.admin-effort.sampled','admin-effort',v_id,'recorded','Administrative-effort outcome sample recorded.',NULL,NULL,jsonb_build_object('period',p_period,'sampleType',p_sample_type));
  RETURN jsonb_build_object('sampleId',v_id,'period',p_period,'sampleType',p_sample_type);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.outcome_metrics(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_role text; base record; cur record; v_baseline real; v_current real;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id); v_role:=ctx->>'role';
  IF v_role NOT IN ('pmo','project-manager','project-director','program-manager') THEN RAISE EXCEPTION 'Outcome measurement is not available to this responsibility.' USING ERRCODE='42501'; END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) OR NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN RAISE EXCEPTION 'Project outcome metrics are outside this responsibility.' USING ERRCODE='42501'; END IF;

  SELECT *,status_collection_minutes+reconciliation_minutes+chasing_minutes+reporting_minutes+duplicate_governance_minutes+decision_preparation_minutes total_minutes INTO base FROM public.admin_effort_samples WHERE project_id=p_project_id AND sample_type='baseline' ORDER BY recorded_at DESC LIMIT 1;
  SELECT *,status_collection_minutes+reconciliation_minutes+chasing_minutes+reporting_minutes+duplicate_governance_minutes+decision_preparation_minutes total_minutes INTO cur FROM public.admin_effort_samples WHERE project_id=p_project_id AND sample_type='current' ORDER BY recorded_at DESC LIMIT 1;
  v_baseline:=base.total_minutes; v_current:=cur.total_minutes;

  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'M1_adminEffort',CASE WHEN v_baseline IS NULL OR v_current IS NULL OR v_baseline=0 THEN jsonb_build_object('state','data-insufficient','baselineMinutes',v_baseline,'currentMinutes',v_current,'reason','A baseline and current administrative-effort sample are both required.') ELSE jsonb_build_object('state','measured','baselineMinutes',v_baseline,'currentMinutes',v_current,'reductionPercent',round(((v_baseline-v_current)/v_baseline*100)::numeric,1),'baselinePeriod',base.period,'currentPeriod',cur.period) END,
    'M2_detectionLeadTime',jsonb_build_object('state','data-insufficient','reason','Actual manifestation/miss timestamps are not yet captured as a governed outcome observation.'),
    'M3_warningPrecision',jsonb_build_object('state','data-insufficient','reason','Warnings need subsequent validated outcome labels before precision can be measured.'),
    'M4_decisionLatency',jsonb_build_object(
      'state',CASE WHEN EXISTS(SELECT 1 FROM public.pc_decisions d WHERE d.project_id=p_project_id AND d.decided_at IS NOT NULL) THEN 'measured' ELSE 'data-insufficient' END,
      'closedDecisions',(SELECT count(*) FROM public.pc_decisions d WHERE d.project_id=p_project_id AND d.decided_at IS NOT NULL),
      'medianHours',(SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.decided_at::timestamptz-d.created_at::timestamptz))/3600.0)::numeric,1) FROM public.pc_decisions d WHERE d.project_id=p_project_id AND d.decided_at IS NOT NULL),
      'closedByNeededByPercent',(SELECT CASE WHEN count(*)=0 THEN NULL ELSE round((100.0*count(*) FILTER (WHERE d.needed_by IS NOT NULL AND d.decided_at::date<=d.needed_by::date)/count(*))::numeric,1) END FROM public.pc_decisions d WHERE d.project_id=p_project_id AND d.decided_at IS NOT NULL)
    ),
    'M6_capacityConflictLeadTime',jsonb_build_object('state','data-insufficient','reason','Capacity periods/allocations must contain real planning windows and confirmed conflicts before lead time is meaningful.'),
    'M8_evidenceCoverage',jsonb_build_object(
      'state',CASE WHEN EXISTS(SELECT 1 FROM public.pc_commitments c WHERE c.project_id=p_project_id AND c.state IN ('active','ready-for-acceptance')) THEN 'measured' ELSE 'data-insufficient' END,
      'activeCommitments',(SELECT count(*) FROM public.pc_commitments c WHERE c.project_id=p_project_id AND c.state IN ('active','ready-for-acceptance')),
      'averageCoveragePercent',(SELECT round((100*avg(CASE WHEN jsonb_array_length(c.evidence_spec_json::jsonb)=0 THEN NULL ELSE (SELECT count(DISTINCT e.evidence_kind)::real FROM public.pc_evidence_links e WHERE e.commitment_id=c.id AND e.lifecycle_state='active' AND e.freshness_state='current' AND e.evidence_kind IN (SELECT jsonb_array_elements_text(c.evidence_spec_json::jsonb)))/jsonb_array_length(c.evidence_spec_json::jsonb)::real END))::numeric,1) FROM public.pc_commitments c WHERE c.project_id=p_project_id AND c.state IN ('active','ready-for-acceptance'))
    ),
    'M9_dataFreshness',jsonb_build_object(
      'state',CASE WHEN EXISTS(SELECT 1 FROM public.pc_evidence_links e WHERE e.project_id=p_project_id AND e.lifecycle_state='active') THEN 'measured' ELSE 'data-insufficient' END,
      'activeEvidence',(SELECT count(*) FROM public.pc_evidence_links e WHERE e.project_id=p_project_id AND e.lifecycle_state='active'),
      'currentEvidencePercent',(SELECT CASE WHEN count(*)=0 THEN NULL ELSE round((100.0*count(*) FILTER (WHERE e.freshness_state='current')/count(*))::numeric,1) END FROM public.pc_evidence_links e WHERE e.project_id=p_project_id AND e.lifecycle_state='active')
    ),
    'M11_aiTrust',jsonb_build_object('state','data-insufficient','reason','MVP has no production AI recommendation disposition dataset yet; unauthorized AI writes remain prohibited.'),
    'M12_notificationNoise',jsonb_build_object(
      'state',CASE WHEN EXISTS(SELECT 1 FROM public.pc_notifications n WHERE n.project_id=p_project_id) THEN 'measured' ELSE 'data-insufficient' END,
      'total',(SELECT count(*) FROM public.pc_notifications n WHERE n.project_id=p_project_id AND n.shadow_suppressed=0),
      'snoozed',(SELECT count(*) FROM public.pc_notifications n WHERE n.project_id=p_project_id AND n.shadow_suppressed=0 AND n.state='snoozed'),
      'resolved',(SELECT count(*) FROM public.pc_notifications n WHERE n.project_id=p_project_id AND n.shadow_suppressed=0 AND n.state='resolved'),
      'snoozeRatePercent',(SELECT CASE WHEN count(*)=0 THEN NULL ELSE round((100.0*count(*) FILTER (WHERE n.state='snoozed')/count(*))::numeric,1) END FROM public.pc_notifications n WHERE n.project_id=p_project_id AND n.shadow_suppressed=0)
    ),
    'M13_onboardingEffort',jsonb_build_object('state','data-insufficient','reason','In-flight project onboarding elapsed time and manual preparation effort are not yet captured as a governed measurement.'),
    'measuredAt',now()::text
  );
END
$$;

REVOKE ALL ON FUNCTION goliath_api.integration_health(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.record_admin_effort_sample(text,text,text,text,real,real,real,real,real,real) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.outcome_metrics(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.integration_health(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.record_admin_effort_sample(text,text,text,text,real,real,real,real,real,real) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.outcome_metrics(text,text) TO authenticated;

COMMIT;

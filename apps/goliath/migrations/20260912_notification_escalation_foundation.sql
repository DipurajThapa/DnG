-- Goliath notification and escalation foundation
-- Date: 2026-09-12
-- Purpose: responsibility/time-driven in-app control; no event firehose and no external auto-escalation.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pc_notifications (
  id text PRIMARY KEY DEFAULT ('ntf-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  recipient_user_id text NOT NULL,
  notification_type text NOT NULL CHECK (notification_type IN (
    'upcoming','decision-needed','decision-overdue','dependency-at-risk','dependency-late','commitment-overdue','evidence-insufficient','approval-needed','health-deterioration'
  )),
  source_type text NOT NULL CHECK (source_type IN ('commitment','decision','dependency','report','health','change','other')),
  source_id text NOT NULL,
  cause_key text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','attention','high','critical')),
  message text NOT NULL,
  actions_json text NOT NULL DEFAULT '[]',
  data_class text NOT NULL DEFAULT 'delivery' CHECK (data_class IN ('delivery','financial-cost','financial-billing','hr','client-confidential','audit')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','acknowledged','snoozed','resolved','suppressed')),
  due_at text,
  created_at text NOT NULL,
  acknowledged_at text,
  snoozed_until text,
  response_reason text,
  resolved_at text,
  shadow_suppressed integer NOT NULL DEFAULT 0 CHECK (shadow_suppressed IN (0,1)),
  revision integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pc_open_notification
  ON public.pc_notifications(recipient_user_id,notification_type,source_type,source_id,cause_key)
  WHERE state IN ('open','acknowledged','snoozed');
CREATE INDEX IF NOT EXISTS idx_pc_notifications_recipient_state
  ON public.pc_notifications(recipient_user_id,state,due_at,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_notifications_project_state
  ON public.pc_notifications(project_id,state,notification_type);

CREATE TABLE IF NOT EXISTS public.pc_escalations (
  id text PRIMARY KEY DEFAULT ('esc-'||gen_random_uuid()::text),
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('commitment','decision','dependency','health','change','other')),
  source_id text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('hard-rule','human-flag','corroborated-health')),
  current_level text NOT NULL CHECK (current_level IN ('owner','project-manager','program-manager','project-director','sponsor')),
  assigned_user_id text,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','acknowledged','acted','resolved','cancelled')),
  started_at text NOT NULL,
  acknowledged_at text,
  acted_at text,
  next_review_at text,
  reason text NOT NULL,
  external_boundary integer NOT NULL DEFAULT 0 CHECK (external_boundary IN (0,1)),
  revision integer NOT NULL DEFAULT 1,
  UNIQUE(project_id,source_type,source_id,trigger_type)
);

CREATE INDEX IF NOT EXISTS idx_pc_escalations_project_state
  ON public.pc_escalations(project_id,state,current_level,next_review_at);

CREATE OR REPLACE FUNCTION goliath_api.upsert_internal_notification(
  p_project_id text,
  p_recipient_user_id text,
  p_notification_type text,
  p_source_type text,
  p_source_id text,
  p_cause_key text,
  p_severity text,
  p_message text,
  p_actions jsonb,
  p_due_at text DEFAULT NULL,
  p_shadow_suppressed boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE v_id text;
BEGIN
  INSERT INTO public.pc_notifications(
    project_id,recipient_user_id,notification_type,source_type,source_id,cause_key,
    severity,message,actions_json,data_class,state,due_at,created_at,shadow_suppressed
  ) VALUES(
    p_project_id,p_recipient_user_id,p_notification_type,p_source_type,p_source_id,p_cause_key,
    p_severity,p_message,COALESCE(p_actions,'[]'::jsonb)::text,'delivery',
    CASE WHEN p_shadow_suppressed THEN 'suppressed' ELSE 'open' END,
    p_due_at,now()::text,CASE WHEN p_shadow_suppressed THEN 1 ELSE 0 END
  )
  ON CONFLICT (recipient_user_id,notification_type,source_type,source_id,cause_key)
    WHERE state IN ('open','acknowledged','snoozed')
  DO UPDATE SET
    severity=EXCLUDED.severity,
    message=EXCLUDED.message,
    actions_json=EXCLUDED.actions_json,
    due_at=EXCLUDED.due_at,
    revision=public.pc_notifications.revision+1
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION goliath_api.upsert_internal_notification(text,text,text,text,text,text,text,text,jsonb,text,boolean) FROM PUBLIC,anonymous,goliath_web_anon,authenticated;

CREATE OR REPLACE FUNCTION goliath_api.refresh_responsibility_notifications(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  ctx jsonb;
  v_role text;
  r record;
  v_created integer:=0;
  v_id text;
  pol public.pc_health_policies%ROWTYPE;
  near_date date;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  v_role:=ctx->>'role';
  IF v_role NOT IN ('project-manager','project-director','program-manager','pmo') THEN
    RAISE EXCEPTION 'This responsibility cannot refresh project control notifications.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','write') THEN
    RAISE EXCEPTION 'Delivery write authority is required.' USING ERRCODE='42501';
  END IF;

  SELECT * INTO pol FROM public.pc_health_policies WHERE project_id=p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Health/control policy is not configured for this project.' USING ERRCODE='22023';
  END IF;
  near_date:=goliath_api.add_working_days(current_date,10);

  -- Upcoming commitment: deterministic responsibility/time signal, independent of health shadow mode.
  FOR r IN
    SELECT c.id,c.title,c.accountable_owner_id,c.committed_date,c.evidence_maturity
    FROM public.pc_commitments c
    WHERE c.project_id=p_project_id
      AND c.state IN ('active','ready-for-acceptance')
      AND c.accountable_owner_id IS NOT NULL
      AND c.committed_date IS NOT NULL
      AND c.committed_date::date BETWEEN current_date AND near_date
      AND c.evidence_maturity NOT IN ('accepted','verified-in-production')
  LOOP
    v_id:=goliath_api.upsert_internal_notification(
      p_project_id,r.accountable_owner_id,'upcoming','commitment',r.id,'commitment-due',
      'attention','Commitment approaching its committed date: '||r.title,
      jsonb_build_array('confirm-on-track','flag-risk','request-help'),r.committed_date,false
    );
    v_created:=v_created+1;
  END LOOP;

  -- Hard overdue commitment: deterministic escalation trigger.
  FOR r IN
    SELECT c.id,c.title,c.accountable_owner_id,c.committed_date
    FROM public.pc_commitments c
    WHERE c.project_id=p_project_id
      AND c.state NOT IN ('accepted','waived','cancelled','closed')
      AND c.accountable_owner_id IS NOT NULL
      AND c.committed_date IS NOT NULL
      AND c.committed_date::date<current_date
  LOOP
    v_id:=goliath_api.upsert_internal_notification(
      p_project_id,r.accountable_owner_id,'commitment-overdue','commitment',r.id,'committed-date-passed',
      'high','Committed date has passed without acceptance: '||r.title,
      jsonb_build_array('reforecast','request-help','escalate'),r.committed_date,false
    );
    INSERT INTO public.pc_escalations(project_id,source_type,source_id,trigger_type,current_level,assigned_user_id,state,started_at,next_review_at,reason,external_boundary)
    VALUES(p_project_id,'commitment',r.id,'hard-rule','owner',r.accountable_owner_id,'open',now()::text,(current_date+1)::text,'Committed date passed without acceptance.',0)
    ON CONFLICT (project_id,source_type,source_id,trigger_type) DO NOTHING;
    v_created:=v_created+1;
  END LOOP;

  -- Decision needed and overdue. Decision owner/delegate is the only direct recipient.
  FOR r IN
    SELECT d.id,d.question,d.decision_owner_id,d.delegated_to,d.needed_by,
           CASE WHEN d.needed_by::date<current_date THEN 'decision-overdue' ELSE 'decision-needed' END AS nt,
           CASE WHEN d.needed_by::date<current_date THEN 'high' ELSE 'attention' END AS sev
    FROM public.pc_decisions d
    WHERE d.project_id=p_project_id AND d.state='pending' AND d.needed_by IS NOT NULL
      AND d.needed_by::date<=current_date+pol.decision_warning_days
  LOOP
    v_id:=goliath_api.upsert_internal_notification(
      p_project_id,COALESCE(r.delegated_to,r.decision_owner_id),r.nt,'decision',r.id,'decision-clock',
      r.sev,'Decision requires action: '||COALESCE(r.question,r.id),
      jsonb_build_array('decide','delegate','request-info'),r.needed_by,false
    );
    IF r.nt='decision-overdue' THEN
      INSERT INTO public.pc_escalations(project_id,source_type,source_id,trigger_type,current_level,assigned_user_id,state,started_at,next_review_at,reason,external_boundary)
      VALUES(p_project_id,'decision',r.id,'hard-rule','owner',COALESCE(r.delegated_to,r.decision_owner_id),'open',now()::text,(current_date+1)::text,'Decision is past needed-by date.',0)
      ON CONFLICT (project_id,source_type,source_id,trigger_type) DO NOTHING;
    END IF;
    v_created:=v_created+1;
  END LOOP;

  -- Dependency promises. External-party dependencies terminate at the internal PM rather than auto-chasing the party.
  FOR r IN
    SELECT d.id,d.state,d.provider_type,d.provider_ref,d.needed_by,d.promised_date,
           consumer.accountable_owner_id AS consumer_owner,
           provider.accountable_owner_id AS provider_owner
    FROM public.pc_commitment_dependencies d
    JOIN public.pc_commitments consumer ON consumer.id=d.consumer_commitment_id
    LEFT JOIN public.pc_commitments provider ON provider.id=d.provider_commitment_id
    WHERE d.project_id=p_project_id
      AND d.state IN ('at-risk','late','renegotiation')
  LOOP
    v_id:=goliath_api.upsert_internal_notification(
      p_project_id,r.consumer_owner,
      CASE WHEN r.state='late' THEN 'dependency-late' ELSE 'dependency-at-risk' END,
      'dependency',r.id,'provider-promise',CASE WHEN r.state='late' THEN 'high' ELSE 'attention' END,
      'Dependency requires attention before consumer need-by date.',
      jsonb_build_array('acknowledge','renegotiate','request-help'),r.needed_by,false
    );
    IF r.provider_type='commitment' AND r.provider_owner IS NOT NULL THEN
      PERFORM goliath_api.upsert_internal_notification(
        p_project_id,r.provider_owner,
        CASE WHEN r.state='late' THEN 'dependency-late' ELSE 'dependency-at-risk' END,
        'dependency',r.id,'provider-promise',CASE WHEN r.state='late' THEN 'high' ELSE 'attention' END,
        'A dependency you provide is at risk for a consuming commitment.',
        jsonb_build_array('acknowledge','renegotiate'),r.needed_by,false
      );
    END IF;
    IF r.state='late' THEN
      INSERT INTO public.pc_escalations(project_id,source_type,source_id,trigger_type,current_level,assigned_user_id,state,started_at,next_review_at,reason,external_boundary)
      VALUES(p_project_id,'dependency',r.id,'hard-rule','owner',r.consumer_owner,'open',now()::text,(current_date+1)::text,'Dependency is late.',CASE WHEN r.provider_type='party' THEN 1 ELSE 0 END)
      ON CONFLICT (project_id,source_type,source_id,trigger_type) DO NOTHING;
    END IF;
    v_created:=v_created+1;
  END LOOP;

  -- Health-based notifications are intentionally suppressed while shadow mode is active.
  IF pol.shadow_mode=0 THEN
    FOR r IN
      SELECT h.subject_id,h.overall_state,h.primary_cause,c.accountable_owner_id,c.title
      FROM public.pc_health_records h
      JOIN public.pc_commitments c ON c.id=h.subject_id
      WHERE h.project_id=p_project_id AND h.subject_type='commitment'
        AND h.computed_at=(SELECT max(h2.computed_at) FROM public.pc_health_records h2 WHERE h2.project_id=h.project_id AND h2.subject_type=h.subject_type AND h2.subject_id=h.subject_id)
        AND h.overall_state IN ('at-risk','blocked','likely-to-miss')
    LOOP
      IF r.accountable_owner_id IS NOT NULL THEN
        PERFORM goliath_api.upsert_internal_notification(
          p_project_id,r.accountable_owner_id,'health-deterioration','health',r.subject_id,'computed-health',
          CASE WHEN r.overall_state IN ('blocked','likely-to-miss') THEN 'high' ELSE 'attention' END,
          'Commitment health changed to '||r.overall_state||': '||r.title||' · cause '||r.primary_cause,
          jsonb_build_array('open-evidence','flag-risk','request-help'),NULL,false
        );
      END IF;
    END LOOP;
  END IF;

  PERFORM goliath_api.append_project_event(p_project_id,ctx->>'userId','notifications.refreshed','notification-run',gen_random_uuid()::text,'recorded','Responsibility/time-driven notification candidates refreshed.',NULL,NULL,jsonb_build_object('signalsProcessed',v_created,'shadowMode',pol.shadow_mode=1));

  RETURN jsonb_build_object('projectId',p_project_id,'signalsProcessed',v_created,'healthNotificationsSuppressedByShadowMode',pol.shadow_mode=1);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.notification_queue(
  p_assignment_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_user text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  v_user:=ctx->>'userId';
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',n.id,'projectId',n.project_id,'type',n.notification_type,'sourceType',n.source_type,
    'sourceId',n.source_id,'severity',n.severity,'message',n.message,'actions',n.actions_json::jsonb,
    'state',n.state,'dueAt',n.due_at,'createdAt',n.created_at,'snoozedUntil',n.snoozed_until,'revision',n.revision
  ) ORDER BY CASE n.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'attention' THEN 2 ELSE 1 END DESC,n.due_at NULLS LAST,n.created_at DESC)
  FROM public.pc_notifications n
  WHERE n.recipient_user_id=v_user
    AND n.state IN ('open','acknowledged','snoozed')
    AND (n.state<>'snoozed' OR n.snoozed_until IS NULL OR n.snoozed_until<=now()::text)
    AND goliath_api.context_allows_project(p_assignment_id,n.project_id)
    AND goliath_api.context_has_data_class(p_assignment_id,n.data_class,'read')),'[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.respond_notification(
  p_assignment_id text,
  p_notification_id text,
  p_action text,
  p_reason text DEFAULT NULL,
  p_snooze_until text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; n public.pc_notifications%ROWTYPE; v_user text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id); v_user:=ctx->>'userId';
  SELECT * INTO n FROM public.pc_notifications WHERE id=p_notification_id FOR UPDATE;
  IF NOT FOUND OR n.recipient_user_id<>v_user OR NOT goliath_api.context_allows_project(p_assignment_id,n.project_id) THEN
    RAISE EXCEPTION 'Notification is not available to the authenticated responsibility.' USING ERRCODE='42501';
  END IF;
  IF p_action NOT IN ('acknowledge','snooze','resolve') THEN
    RAISE EXCEPTION 'Unsupported notification response.' USING ERRCODE='22023';
  END IF;
  IF p_action='snooze' AND (p_snooze_until IS NULL OR p_snooze_until<=now()::text OR COALESCE(length(trim(p_reason)),0)<3) THEN
    RAISE EXCEPTION 'Snooze requires a future date and a reason.' USING ERRCODE='22023';
  END IF;
  IF p_action='resolve' AND COALESCE(length(trim(p_reason)),0)<3 THEN
    RAISE EXCEPTION 'Resolving a control notification requires a reason.' USING ERRCODE='22023';
  END IF;
  UPDATE public.pc_notifications SET
    state=CASE p_action WHEN 'acknowledge' THEN 'acknowledged' WHEN 'snooze' THEN 'snoozed' ELSE 'resolved' END,
    acknowledged_at=CASE WHEN p_action='acknowledge' THEN now()::text ELSE acknowledged_at END,
    snoozed_until=CASE WHEN p_action='snooze' THEN p_snooze_until ELSE snoozed_until END,
    response_reason=NULLIF(trim(p_reason),''),
    resolved_at=CASE WHEN p_action='resolve' THEN now()::text ELSE resolved_at END,
    revision=revision+1
  WHERE id=n.id;
  PERFORM goliath_api.append_project_event(n.project_id,v_user,'notification.'||p_action,'notification',n.id,'recorded',COALESCE(NULLIF(trim(p_reason),''),'Notification acknowledged.'),n.revision,n.revision+1,jsonb_build_object('sourceType',n.source_type,'sourceId',n.source_id));
  RETURN jsonb_build_object('notificationId',n.id,'action',p_action);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.escalation_board(
  p_assignment_id text,
  p_project_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_role text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id); v_role:=ctx->>'role';
  IF v_role NOT IN ('project-manager','project-director','program-manager','pmo','sponsor') THEN
    RAISE EXCEPTION 'Escalation board is not available to this responsibility.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',e.id,'sourceType',e.source_type,'sourceId',e.source_id,'triggerType',e.trigger_type,
    'currentLevel',e.current_level,'assignedUserId',e.assigned_user_id,'state',e.state,
    'startedAt',e.started_at,'acknowledgedAt',e.acknowledged_at,'actedAt',e.acted_at,
    'nextReviewAt',e.next_review_at,'reason',e.reason,'externalBoundary',e.external_boundary=1,'revision',e.revision
  ) ORDER BY e.started_at,e.id) FROM public.pc_escalations e
  WHERE e.project_id=p_project_id AND e.state NOT IN ('resolved','cancelled')),'[]'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION goliath_api.refresh_responsibility_notifications(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.notification_queue(text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.respond_notification(text,text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.escalation_board(text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.refresh_responsibility_notifications(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.notification_queue(text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.respond_notification(text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.escalation_board(text,text) TO authenticated;

COMMIT;

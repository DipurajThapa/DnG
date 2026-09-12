-- Goliath field ownership, provenance and data-class authorization foundation
-- Development branch only. Additive; does not remove or rewrite existing project data.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pc_field_ownership_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_type text NOT NULL,
  field_name text NOT NULL,
  owner_system text NOT NULL,
  goliath_mode text NOT NULL
    CHECK (goliath_mode IN ('own','mirror','derived','link-only','write-once-key','configurable')),
  two_way_policy text NOT NULL DEFAULT 'none'
    CHECK (two_way_policy IN ('none','enumerated','publish-only','reconcile-and-queue')),
  data_class text NOT NULL DEFAULT 'delivery'
    CHECK (data_class IN ('delivery','financial-cost','financial-billing','hr','client-confidential','audit')),
  provenance_required integer NOT NULL DEFAULT 1 CHECK (provenance_required IN (0,1)),
  rationale text NOT NULL,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  version integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT (now()::text),
  UNIQUE(entity_type,field_name,version)
);

CREATE INDEX IF NOT EXISTS idx_pc_field_ownership_active
  ON public.pc_field_ownership_rules(entity_type,field_name,active);

CREATE TABLE IF NOT EXISTS public.ec_role_data_class_defaults (
  role text NOT NULL,
  data_class text NOT NULL
    CHECK (data_class IN ('delivery','financial-cost','financial-billing','hr','client-confidential','audit')),
  can_read integer NOT NULL DEFAULT 0 CHECK (can_read IN (0,1)),
  can_write integer NOT NULL DEFAULT 0 CHECK (can_write IN (0,1)),
  rationale text NOT NULL,
  PRIMARY KEY(role,data_class),
  CHECK (can_write = 0 OR can_read = 1)
);

CREATE TABLE IF NOT EXISTS public.ec_data_class_overrides (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  assignment_id text NOT NULL REFERENCES public.ec_responsibility_assignments(id),
  data_class text NOT NULL
    CHECK (data_class IN ('delivery','financial-cost','financial-billing','hr','client-confidential','audit')),
  can_read integer NOT NULL CHECK (can_read IN (0,1)),
  can_write integer NOT NULL CHECK (can_write IN (0,1)),
  reason text NOT NULL,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  granted_by text NOT NULL,
  granted_at text NOT NULL,
  revoked_by text,
  revoked_at text,
  revision integer NOT NULL DEFAULT 1,
  CHECK (can_write = 0 OR can_read = 1),
  CHECK ((active=1 AND revoked_at IS NULL) OR active=0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_active_data_class_override
  ON public.ec_data_class_overrides(assignment_id,data_class)
  WHERE active=1;

INSERT INTO public.pc_field_ownership_rules
(entity_type,field_name,owner_system,goliath_mode,two_way_policy,data_class,provenance_required,rationale)
VALUES
('external-work-item','status','execution-system','mirror','none','delivery',1,'Task/work-item status remains authoritative in the execution system.'),
('external-work-item','assignee','execution-system','mirror','none','delivery',1,'Task assignee remains authoritative in the execution system.'),
('external-work-item','sprint','execution-system','mirror','none','delivery',1,'Sprint/iteration placement remains authoritative in the execution system.'),
('external-work-item','story-points','execution-system','mirror','none','delivery',1,'Story points remain execution evidence, not a Goliath commitment.'),
('external-work-item','goliath-commitment-key','goliath','write-once-key','reconcile-and-queue','delivery',1,'Enumerated linkage key may be written once and discrepancies are reconciled, never overwritten silently.'),
('source-code','commit-pr-build-deploy','git-ci','mirror','none','delivery',1,'Code/build/deploy events remain authoritative in engineering systems.'),
('person','master-record','hris','mirror','none','hr',1,'People master data is owned by HRIS.'),
('person','leave-contract-availability','hris','mirror','none','hr',1,'Leave, contract and detailed availability remain HR-owned.'),
('effort-actual','approved-hours','timesheet-psa','mirror','none','delivery',1,'Approved effort actuals come from the chosen time/PSA authority.'),
('finance','posted-cost','erp','mirror','none','financial-cost',1,'Posted cost remains ERP-authoritative.'),
('finance','invoice-revenue','erp','mirror','none','financial-billing',1,'Invoices and revenue remain ERP/finance-authoritative.'),
('commitment','*','goliath','own','none','delivery',1,'Commitments are Goliath-owned management objects.'),
('decision','*','goliath','own','none','delivery',1,'Decisions and their rationale are Goliath-owned.'),
('dependency','*','goliath','own','none','delivery',1,'Two-party dependencies are Goliath-owned.'),
('raid','*','goliath','own','none','delivery',1,'Risks, issues and assumptions are Goliath-owned management objects.'),
('change-request','*','goliath','own','none','delivery',1,'Change requests and routing are Goliath-owned.'),
('baseline','*','goliath','own','none','delivery',1,'Approved baseline versions and diffs are Goliath-owned.'),
('health','*','goliath','derived','none','delivery',1,'Health is computed from governed evidence and may inherit a higher class from restricted inputs.'),
('forecast','*','goliath','derived','none','delivery',1,'Forecasts are governed derived values with retained inputs/provenance.'),
('evidence-link','*','goliath','own','none','delivery',1,'Goliath owns the linkage/provenance record while the evidence remains external.'),
('report-snapshot','*','goliath','own','none','delivery',1,'Distributed report snapshots are Goliath-owned records of what was rendered.'),
('audit-event','*','goliath','own','none','audit',1,'Audit events are Goliath-owned and separately classified.')
ON CONFLICT (entity_type,field_name,version) DO NOTHING;

-- Delivery access is the normal default. Restricted classes remain explicit.
INSERT INTO public.ec_role_data_class_defaults(role,data_class,can_read,can_write,rationale)
VALUES
('enterprise-admin','delivery',0,0,'Administration authority does not imply project-delivery visibility.'),
('enterprise-admin','audit',1,0,'Enterprise Admin may inspect platform audit; project data still follows separate grants.'),
('pmo','delivery',1,1,'PMO governs delivery controls within responsibility scope.'),
('portfolio-manager','delivery',1,0,'Portfolio role reads governed delivery roll-ups.'),
('program-manager','delivery',1,1,'Program role operates governed delivery controls within scope.'),
('project-director','delivery',1,1,'Project Director operates governed delivery controls within scope.'),
('project-manager','delivery',1,1,'Project Manager operates governed delivery controls within project scope.'),
('sponsor','delivery',1,1,'Sponsor can read delivery and perform authorised decision actions; object-level rules still apply.'),
('resource-manager','delivery',1,1,'Resource Manager needs delivery demand/allocation context.'),
('resource-manager','hr',1,0,'Resource Manager may read authorised capacity/availability detail; people decisions remain human-controlled.'),
('delivery-lead','delivery',1,1,'Delivery Lead operates scoped team delivery controls.'),
('agile-delivery-lead','delivery',1,1,'Agile Delivery Lead operates scoped flow/delivery controls.'),
('team-member','delivery',1,1,'Team Member reads and updates only objects separately authorised to them.')
ON CONFLICT (role,data_class) DO UPDATE
SET can_read=EXCLUDED.can_read,
    can_write=EXCLUDED.can_write,
    rationale=EXCLUDED.rationale;

CREATE OR REPLACE FUNCTION goliath_api.data_class_rank(p_data_class text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_data_class
    WHEN 'delivery' THEN 10
    WHEN 'client-confidential' THEN 20
    WHEN 'financial-cost' THEN 30
    WHEN 'financial-billing' THEN 40
    WHEN 'hr' THEN 50
    WHEN 'audit' THEN 60
    ELSE 999
  END
$$;

CREATE OR REPLACE FUNCTION goliath_api.context_has_data_class(
  p_assignment_id text,
  p_data_class text,
  p_action text DEFAULT 'read'
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  v_read integer;
  v_write integer;
BEGIN
  c := goliath_api.require_context(p_assignment_id);

  IF p_data_class NOT IN ('delivery','financial-cost','financial-billing','hr','client-confidential','audit') THEN
    RETURN false;
  END IF;
  IF p_action NOT IN ('read','write') THEN
    RETURN false;
  END IF;

  SELECT o.can_read,o.can_write
  INTO v_read,v_write
  FROM public.ec_data_class_overrides o
  WHERE o.assignment_id=p_assignment_id
    AND o.data_class=p_data_class
    AND o.active=1
  ORDER BY o.granted_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN CASE WHEN p_action='write' THEN v_write=1 ELSE v_read=1 END;
  END IF;

  SELECT d.can_read,d.can_write
  INTO v_read,v_write
  FROM public.ec_role_data_class_defaults d
  WHERE d.role=c->>'role' AND d.data_class=p_data_class;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN CASE WHEN p_action='write' THEN v_write=1 ELSE v_read=1 END;
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.field_ownership_catalog(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
BEGIN
  c := goliath_api.require_context(p_assignment_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'entityType',r.entity_type,
      'fieldName',r.field_name,
      'ownerSystem',r.owner_system,
      'goliathMode',r.goliath_mode,
      'twoWayPolicy',r.two_way_policy,
      'dataClass',r.data_class,
      'provenanceRequired',r.provenance_required=1,
      'rationale',r.rationale,
      'version',r.version
    ) ORDER BY r.entity_type,r.field_name)
    FROM public.pc_field_ownership_rules r
    WHERE r.active=1
  ),'[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.commitment_evidence_projection(
  p_assignment_id text,
  p_commitment_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  v_project_id text;
  v_partial boolean;
BEGIN
  c := goliath_api.require_context(p_assignment_id);

  SELECT project_id INTO v_project_id
  FROM public.pc_commitments
  WHERE id=p_commitment_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Commitment not found.' USING ERRCODE='22023';
  END IF;

  IF NOT goliath_api.context_allows_project(p_assignment_id,v_project_id) THEN
    RAISE EXCEPTION 'Commitment is outside this responsibility context.' USING ERRCODE='42501';
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.pc_evidence_links e
    WHERE e.commitment_id=p_commitment_id
      AND e.lifecycle_state<>'deleted'
      AND NOT goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')
  ) INTO v_partial;

  RETURN jsonb_build_object(
    'commitmentId',p_commitment_id,
    'projectId',v_project_id,
    'partial',v_partial,
    'evidence',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',e.id,
        'kind',e.evidence_kind,
        'sourceSystem',e.source_system,
        'sourceObjectType',e.source_object_type,
        'sourceObjectId',e.source_object_id,
        'sourceUrl',e.source_url,
        'ownerSystem',e.owner_system,
        'sourceVersion',e.source_version,
        'sourceUpdatedAt',e.source_updated_at,
        'ingestedAt',e.ingested_at,
        'lastReconciledAt',e.last_reconciled_at,
        'mappingVersion',e.mapping_version,
        'freshness',e.freshness_state,
        'lifecycle',e.lifecycle_state,
        'ingestionMode',e.ingestion_mode,
        'classification',e.classification,
        'origin',e.origin,
        'provenanceComplete',(
          e.source_system IS NOT NULL AND e.owner_system IS NOT NULL AND
          e.source_object_id IS NOT NULL AND e.ingested_at IS NOT NULL
        )
      ) ORDER BY e.ingested_at DESC)
      FROM public.pc_evidence_links e
      WHERE e.commitment_id=p_commitment_id
        AND e.lifecycle_state<>'deleted'
        AND goliath_api.context_has_data_class(p_assignment_id,e.classification,'read')
    ),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_data_class_state(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
BEGIN
  c := goliath_api.require_context(p_assignment_id);
  IF c->>'role' <> 'enterprise-admin' THEN
    RAISE EXCEPTION 'Enterprise Admin responsibility required.' USING ERRCODE='42501';
  END IF;

  RETURN jsonb_build_object(
    'defaults',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role',d.role,'dataClass',d.data_class,
        'canRead',d.can_read=1,'canWrite',d.can_write=1,'rationale',d.rationale
      ) ORDER BY d.role,d.data_class)
      FROM public.ec_role_data_class_defaults d
    ),'[]'::jsonb),
    'overrides',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',o.id,'assignmentId',o.assignment_id,'dataClass',o.data_class,
        'canRead',o.can_read=1,'canWrite',o.can_write=1,'reason',o.reason,
        'grantedBy',o.granted_by,'grantedAt',o.granted_at
      ) ORDER BY o.granted_at DESC)
      FROM public.ec_data_class_overrides o
      WHERE o.active=1
    ),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_set_data_class_override(
  p_acting_assignment_id text,
  p_target_assignment_id text,
  p_data_class text,
  p_can_read boolean,
  p_can_write boolean,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  c jsonb;
  t public.ec_responsibility_assignments%ROWTYPE;
  v_id text;
BEGIN
  c := goliath_api.require_context(p_acting_assignment_id);
  IF c->>'role' <> 'enterprise-admin' THEN
    RAISE EXCEPTION 'Enterprise Admin responsibility required.' USING ERRCODE='42501';
  END IF;

  IF p_data_class NOT IN ('delivery','financial-cost','financial-billing','hr','client-confidential','audit') THEN
    RAISE EXCEPTION 'Unsupported data class.' USING ERRCODE='22023';
  END IF;
  IF p_can_write AND NOT p_can_read THEN
    RAISE EXCEPTION 'Write permission requires read permission.' USING ERRCODE='22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason))<5 THEN
    RAISE EXCEPTION 'A meaningful reason is required.' USING ERRCODE='22023';
  END IF;

  SELECT * INTO t
  FROM public.ec_responsibility_assignments
  WHERE id=p_target_assignment_id AND active=1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target responsibility is not active.' USING ERRCODE='22023';
  END IF;

  UPDATE public.ec_data_class_overrides
  SET active=0,
      revoked_by=c->>'userId',
      revoked_at=now()::text,
      revision=revision+1
  WHERE assignment_id=p_target_assignment_id
    AND data_class=p_data_class
    AND active=1;

  INSERT INTO public.ec_data_class_overrides(
    assignment_id,data_class,can_read,can_write,reason,active,
    granted_by,granted_at
  ) VALUES(
    p_target_assignment_id,p_data_class,
    CASE WHEN p_can_read THEN 1 ELSE 0 END,
    CASE WHEN p_can_write THEN 1 ELSE 0 END,
    trim(p_reason),1,c->>'userId',now()::text
  ) RETURNING id INTO v_id;

  PERFORM goliath_api.append_context_event(
    c->>'userId','access.data-class.override',p_acting_assignment_id,
    t.scope_type,t.scope_id,'recorded',trim(p_reason),
    jsonb_build_object(
      'targetAssignmentId',p_target_assignment_id,
      'targetUserId',t.user_id,
      'targetRole',t.role,
      'dataClass',p_data_class,
      'canRead',p_can_read,
      'canWrite',p_can_write,
      'overrideId',v_id
    )
  );

  RETURN jsonb_build_object(
    'overrideId',v_id,
    'assignmentId',p_target_assignment_id,
    'dataClass',p_data_class,
    'canRead',p_can_read,
    'canWrite',p_can_write
  );
END
$$;

REVOKE ALL ON TABLE public.pc_field_ownership_rules FROM PUBLIC, anonymous, authenticated, goliath_web_anon;
REVOKE ALL ON TABLE public.ec_role_data_class_defaults FROM PUBLIC, anonymous, authenticated, goliath_web_anon;
REVOKE ALL ON TABLE public.ec_data_class_overrides FROM PUBLIC, anonymous, authenticated, goliath_web_anon;

REVOKE ALL ON FUNCTION goliath_api.context_has_data_class(text,text,text) FROM PUBLIC, anonymous, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.field_ownership_catalog(text) FROM PUBLIC, anonymous, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.commitment_evidence_projection(text,text) FROM PUBLIC, anonymous, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.admin_data_class_state(text) FROM PUBLIC, anonymous, goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.admin_set_data_class_override(text,text,text,boolean,boolean,text) FROM PUBLIC, anonymous, goliath_web_anon;

GRANT EXECUTE ON FUNCTION goliath_api.context_has_data_class(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.field_ownership_catalog(text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.commitment_evidence_projection(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.admin_data_class_state(text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.admin_set_data_class_override(text,text,text,boolean,boolean,text) TO authenticated;

COMMIT;

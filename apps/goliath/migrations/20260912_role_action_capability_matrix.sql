-- Canonical role x object x action policy for Goliath acceptance and least-privilege control.
-- Authority modes:
--   allow       = role may perform the action within its governed scope.
--   conditional = role may perform only when an object-level ownership condition is satisfied.
--   deny        = role must not perform the action.
-- This catalog does not replace object ownership checks such as named decider/provider/consumer.

CREATE TABLE IF NOT EXISTS platform_identity.action_catalog (
  object_type text NOT NULL,
  action text NOT NULL,
  display_name text NOT NULL,
  data_class text NOT NULL DEFAULT 'delivery',
  consequence text NOT NULL DEFAULT 'normal' CHECK (consequence IN ('read','normal','consequential','administrative')),
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (object_type,action)
);

CREATE TABLE IF NOT EXISTS platform_identity.role_action_policy (
  role_key text NOT NULL REFERENCES platform_identity.role_catalog(role_key),
  object_type text NOT NULL,
  action text NOT NULL,
  authority_mode text NOT NULL CHECK (authority_mode IN ('allow','conditional','deny')),
  condition_code text,
  notes text,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  PRIMARY KEY (role_key,object_type,action),
  FOREIGN KEY (object_type,action) REFERENCES platform_identity.action_catalog(object_type,action)
);

REVOKE ALL ON platform_identity.action_catalog FROM PUBLIC;
REVOKE ALL ON platform_identity.action_catalog FROM authenticated;
REVOKE ALL ON platform_identity.action_catalog FROM goliath_web_anon;
REVOKE ALL ON platform_identity.role_action_policy FROM PUBLIC;
REVOKE ALL ON platform_identity.role_action_policy FROM authenticated;
REVOKE ALL ON platform_identity.role_action_policy FROM goliath_web_anon;

INSERT INTO platform_identity.action_catalog(object_type,action,display_name,data_class,consequence) VALUES
('project','read','View governed project control','delivery','read'),
('commitment','read','View commitments','delivery','read'),
('commitment','confirm-candidate','Confirm commitment candidate','delivery','consequential'),
('commitment','activate','Activate governed commitment','delivery','consequential'),
('decision','read','View decisions','delivery','read'),
('decision','create','Create governed decision','delivery','normal'),
('decision','resolve','Resolve named decision','delivery','consequential'),
('dependency','read','View dependencies','delivery','read'),
('dependency','create','Create two-party dependency','delivery','normal'),
('dependency','acknowledge','Acknowledge dependency','delivery','normal'),
('requirement','read','View requirements','delivery','read'),
('requirement','create','Create governed requirement','delivery','normal'),
('raid','read','View RAID','delivery','read'),
('raid','create-risk','Register risk','delivery','normal'),
('raid','create-issue','Register issue','delivery','normal'),
('raid','create-assumption','Register assumption','delivery','normal'),
('baseline','read','View baseline and change state','delivery','read'),
('baseline','submit','Submit initial baseline for approval','delivery','consequential'),
('baseline','finalize','Apply approved initial baseline','delivery','consequential'),
('report','read','View governed reports','delivery','read'),
('report','snapshot','Create governed report snapshot','delivery','normal'),
('capacity','read','View capacity desk','hr','read'),
('capacity','allocate','Allocate governed capacity','delivery','consequential'),
('integration','read-health','View integration/evidence health','delivery','read'),
('identity','invite','Invite governed identity','audit','administrative'),
('responsibility','grant','Grant governed responsibility','audit','administrative'),
('responsibility','revoke','Revoke governed responsibility','audit','administrative')
ON CONFLICT (object_type,action) DO UPDATE SET display_name=EXCLUDED.display_name,data_class=EXCLUDED.data_class,consequence=EXCLUDED.consequence,active=1;

-- Start from explicit deny for every supported role and every active action.
INSERT INTO platform_identity.role_action_policy(role_key,object_type,action,authority_mode,notes)
SELECT r.role_key,a.object_type,a.action,'deny','Default deny; explicitly overridden below.'
FROM platform_identity.role_catalog r CROSS JOIN platform_identity.action_catalog a
WHERE r.active=1 AND a.active=1
ON CONFLICT (role_key,object_type,action) DO NOTHING;

-- Enterprise administration: identity/responsibility administration only; project delivery stays denied.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Organisation-scoped Enterprise Admin authority.'
WHERE role_key='enterprise-admin' AND (object_type,action) IN (('identity','invite'),('responsibility','grant'),('responsibility','revoke'));

-- Portfolio: project/portfolio visibility and reports, no routine execution authority.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Read-only portfolio oversight.'
WHERE role_key='portfolio-manager' AND (object_type,action) IN (('project','read'),('report','read'));

-- Program manager: cross-project management, decisions/dependencies/requirements/RAID; no routine commitment activation or baseline finalisation.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Program-scoped management authority.'
WHERE role_key='program-manager' AND (object_type,action) IN (
('project','read'),('commitment','read'),('decision','read'),('decision','create'),('dependency','read'),('dependency','create'),
('requirement','read'),('requirement','create'),('raid','read'),('raid','create-risk'),('raid','create-issue'),('raid','create-assumption'),
('baseline','read'),('report','read'),('report','snapshot'),('integration','read-health'));
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-decider-or-delegate',notes='Only when explicitly named as decider/delegate.'
WHERE role_key='program-manager' AND object_type='decision' AND action='resolve';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-provider-or-consumer',notes='Only when accountable for the dependency side.'
WHERE role_key='program-manager' AND object_type='dependency' AND action='acknowledge';

-- Project Director: broad project/program control including baseline and commitment activation.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Director control authority within governed scope.'
WHERE role_key='project-director' AND (object_type,action) IN (
('project','read'),('commitment','read'),('commitment','confirm-candidate'),('commitment','activate'),
('decision','read'),('decision','create'),('dependency','read'),('dependency','create'),('requirement','read'),('requirement','create'),
('raid','read'),('raid','create-risk'),('raid','create-issue'),('raid','create-assumption'),('baseline','read'),('baseline','submit'),('baseline','finalize'),
('report','read'),('report','snapshot'),('integration','read-health'));
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-decider-or-delegate',notes='Only when explicitly named as decider/delegate.' WHERE role_key='project-director' AND object_type='decision' AND action='resolve';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-provider-or-consumer',notes='Only when accountable for the dependency side.' WHERE role_key='project-director' AND object_type='dependency' AND action='acknowledge';

-- Project Manager: detailed project control; cannot self-approve consequential decisions unless named by governance.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Project management authority within project scope.'
WHERE role_key='project-manager' AND (object_type,action) IN (
('project','read'),('commitment','read'),('commitment','confirm-candidate'),('commitment','activate'),
('decision','read'),('decision','create'),('dependency','read'),('dependency','create'),('requirement','read'),('requirement','create'),
('raid','read'),('raid','create-risk'),('raid','create-issue'),('raid','create-assumption'),('baseline','read'),('baseline','submit'),('baseline','finalize'),
('report','read'),('report','snapshot'),('integration','read-health'));
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-decider-or-delegate',notes='Only when explicitly named as decider/delegate.' WHERE role_key='project-manager' AND object_type='decision' AND action='resolve';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-provider-or-consumer',notes='Only when accountable for the dependency side.' WHERE role_key='project-manager' AND object_type='dependency' AND action='acknowledge';

-- PMO: governance/control authority, including baseline and evidence-health controls.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='PMO / project-controls authority within governed scope.'
WHERE role_key='pmo' AND (object_type,action) IN (
('project','read'),('commitment','read'),('commitment','confirm-candidate'),('commitment','activate'),
('decision','read'),('decision','create'),('dependency','read'),('dependency','create'),('requirement','read'),('requirement','create'),
('raid','read'),('raid','create-risk'),('raid','create-issue'),('raid','create-assumption'),('baseline','read'),('baseline','submit'),('baseline','finalize'),
('report','read'),('report','snapshot'),('integration','read-health'));
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-decider-or-delegate',notes='Only when explicitly named as decider/delegate.' WHERE role_key='pmo' AND object_type='decision' AND action='resolve';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-provider-or-consumer',notes='Only when accountable for the dependency side.' WHERE role_key='pmo' AND object_type='dependency' AND action='acknowledge';

-- Resource Manager: capacity only; no unrelated project-control authority.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Capacity-management authority within org-unit scope.'
WHERE role_key='resource-manager' AND (object_type,action) IN (('capacity','read'),('capacity','allocate'));

-- Delivery Lead / Agile Lead: team delivery, issue raising and decision/dependency participation; not baseline/requirement governance.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Team-scoped delivery authority.'
WHERE role_key IN ('delivery-lead','agile-delivery-lead') AND (object_type,action) IN (
('project','read'),('commitment','read'),('decision','read'),('decision','create'),('dependency','read'),('raid','read'),('raid','create-issue'),('report','read'));
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-decider-or-delegate',notes='Only when explicitly named as decider/delegate.' WHERE role_key IN ('delivery-lead','agile-delivery-lead') AND object_type='decision' AND action='resolve';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-provider-or-consumer',notes='Only when accountable for the dependency side.' WHERE role_key IN ('delivery-lead','agile-delivery-lead') AND object_type='dependency' AND action='acknowledge';

-- Team Member: least privilege; own commitments plus conditional decision/dependency participation and issue raising.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Least-privilege delivery participation within owned/team scope.'
WHERE role_key='team-member' AND (object_type,action) IN (('project','read'),('commitment','read'),('decision','read'),('dependency','read'),('raid','read'),('raid','create-issue'));
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-decider-or-delegate',notes='Only when explicitly named as decider/delegate.' WHERE role_key='team-member' AND object_type='decision' AND action='resolve';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-provider-or-consumer',notes='Only when accountable for the dependency side.' WHERE role_key='team-member' AND object_type='dependency' AND action='acknowledge';

-- Sponsor: oversight and consequential decisions; no execution/governance maintenance.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Sponsor oversight within project scope.'
WHERE role_key='sponsor' AND (object_type,action) IN (('project','read'),('commitment','read'),('decision','read'),('report','read'),('baseline','read'));
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-decider-or-delegate',notes='Sponsor decides only when named as decider/delegate.' WHERE role_key='sponsor' AND object_type='decision' AND action='resolve';

CREATE OR REPLACE FUNCTION goliath_api.capability_mode(p_assignment_id text,p_object_type text,p_action text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE c jsonb; p record; v_class_ok boolean;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  SELECT rap.authority_mode,ac.data_class INTO p
  FROM platform_identity.role_action_policy rap
  JOIN platform_identity.action_catalog ac ON ac.object_type=rap.object_type AND ac.action=rap.action
  WHERE rap.role_key=c->>'role' AND rap.object_type=p_object_type AND rap.action=p_action AND rap.active=1 AND ac.active=1;
  IF NOT FOUND THEN RETURN 'deny'; END IF;
  IF p.authority_mode='deny' THEN RETURN 'deny'; END IF;
  v_class_ok:=goliath_api.context_has_data_class(p_assignment_id,p.data_class,CASE WHEN p.action='read' OR p.action LIKE 'read-%' THEN 'read' ELSE 'write' END);
  IF NOT v_class_ok THEN RETURN 'deny'; END IF;
  RETURN p.authority_mode;
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.capability_mode(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.capability_mode(text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION goliath_api.capability_mode(text,text,text) FROM goliath_web_anon;

CREATE OR REPLACE FUNCTION goliath_api.my_capabilities(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE c jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  RETURN jsonb_build_object(
    'assignmentId',c->>'assignmentId','role',c->>'role','scopeType',c->>'scopeType','scopeId',c->>'scopeId','teamId',c->>'teamId',
    'capabilities',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'objectType',ac.object_type,'action',ac.action,'displayName',ac.display_name,'dataClass',ac.data_class,'consequence',ac.consequence,
        'authorityMode',rap.authority_mode,'conditionCode',rap.condition_code,'notes',rap.notes,
        'effectiveMode',goliath_api.capability_mode(p_assignment_id,ac.object_type,ac.action)
      ) ORDER BY ac.object_type,ac.action)
      FROM platform_identity.action_catalog ac
      JOIN platform_identity.role_action_policy rap ON rap.object_type=ac.object_type AND rap.action=ac.action AND rap.role_key=c->>'role'
      WHERE ac.active=1 AND rap.active=1
    ),'[]'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.my_capabilities(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.my_capabilities(text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.my_capabilities(text) TO authenticated;

CREATE OR REPLACE FUNCTION goliath_api.admin_role_capability_matrix(p_acting_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE c jsonb;
BEGIN
  c:=goliath_api.require_context(p_acting_assignment_id);
  IF c->>'role'<>'enterprise-admin' OR NOT goliath_api.context_has_data_class(p_acting_assignment_id,'audit','read') THEN
    RAISE EXCEPTION 'Enterprise Admin audit-read authority is required.' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'roles',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role',r.role_key,'displayName',r.display_name,
        'capabilities',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'objectType',ac.object_type,'action',ac.action,'displayName',ac.display_name,'dataClass',ac.data_class,'consequence',ac.consequence,
          'authorityMode',p.authority_mode,'conditionCode',p.condition_code,'notes',p.notes
        ) ORDER BY ac.object_type,ac.action)
        FROM platform_identity.action_catalog ac
        JOIN platform_identity.role_action_policy p ON p.object_type=ac.object_type AND p.action=ac.action AND p.role_key=r.role_key
        WHERE ac.active=1 AND p.active=1),'[]'::jsonb)
      ) ORDER BY r.display_order,r.role_key)
      FROM platform_identity.role_catalog r WHERE r.active=1
    ),'[]'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.admin_role_capability_matrix(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.admin_role_capability_matrix(text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.admin_role_capability_matrix(text) TO authenticated;

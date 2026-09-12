-- Organisation membership, first-class teams and project-scoped access administration.
-- This is an additive migration. Existing responsibilities remain effective and are
-- backfilled with legacy provenance so access is not silently removed.

CREATE TABLE IF NOT EXISTS platform_identity.organisation_memberships (
  id text PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES public.ec_organisations(id),
  user_id text NOT NULL,
  display_name text NOT NULL,
  contact_email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','departed')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1,
  UNIQUE (organisation_id,user_id)
);

CREATE TABLE IF NOT EXISTS public.ec_teams (
  id text PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES public.ec_organisations(id),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1,
  UNIQUE (organisation_id,code)
);

CREATE TABLE IF NOT EXISTS public.ec_team_memberships (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES public.ec_teams(id),
  organisation_membership_id text NOT NULL REFERENCES platform_identity.organisation_memberships(id),
  membership_type text NOT NULL DEFAULT 'member' CHECK (membership_type IN ('member','manager')),
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  assigned_by text NOT NULL,
  reason text,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE (team_id,organisation_membership_id)
);

CREATE TABLE IF NOT EXISTS public.pc_project_memberships (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  organisation_membership_id text NOT NULL REFERENCES platform_identity.organisation_memberships(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  admission_source text NOT NULL DEFAULT 'direct' CHECK (admission_source IN ('direct','team','legacy')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  assigned_by text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE (project_id,organisation_membership_id)
);

CREATE TABLE IF NOT EXISTS public.pc_project_team_assignments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.pc_projects(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES public.ec_teams(id),
  access_role text NOT NULL DEFAULT 'team-member',
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  assigned_by text NOT NULL,
  reason text,
  revision integer NOT NULL DEFAULT 1,
  UNIQUE (project_id,team_id)
);

CREATE TABLE IF NOT EXISTS public.ec_responsibility_sources (
  id text PRIMARY KEY,
  responsibility_id text NOT NULL REFERENCES public.ec_responsibility_assignments(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('legacy','direct','team-project-assignment')),
  source_id text NOT NULL,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by text,
  revoked_at timestamptz,
  revocation_reason text,
  revision integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ec_responsibility_source_active
  ON public.ec_responsibility_sources(responsibility_id,source_type,source_id)
  WHERE active=1;
CREATE INDEX IF NOT EXISTS idx_org_membership_user
  ON platform_identity.organisation_memberships(user_id,organisation_id,status);
CREATE INDEX IF NOT EXISTS idx_team_membership_person
  ON public.ec_team_memberships(organisation_membership_id,active,team_id);
CREATE INDEX IF NOT EXISTS idx_project_membership_person
  ON public.pc_project_memberships(organisation_membership_id,status,project_id);
CREATE INDEX IF NOT EXISTS idx_project_team_active
  ON public.pc_project_team_assignments(team_id,active,project_id);

CREATE OR REPLACE FUNCTION goliath_api.scope_organisation(p_scope_type text,p_scope_id text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','goliath_api'
AS $$
  SELECT CASE p_scope_type
    WHEN 'organisation' THEN (SELECT id FROM public.ec_organisations WHERE id=p_scope_id)
    WHEN 'portfolio' THEN (SELECT organisation_id FROM public.ec_portfolios WHERE id=p_scope_id)
    WHEN 'program' THEN (SELECT pf.organisation_id FROM public.ec_programs pg JOIN public.ec_portfolios pf ON pf.id=pg.portfolio_id WHERE pg.id=p_scope_id)
    WHEN 'project' THEN (SELECT organisation_id FROM public.pc_projects WHERE id=p_scope_id)
    WHEN 'org-unit' THEN (SELECT organisation_id FROM public.ec_org_units WHERE id=p_scope_id)
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION goliath_api.scope_organisation(text,text) FROM PUBLIC,authenticated,goliath_web_anon;

-- Backfill explicit organisation memberships without changing existing access.
WITH people AS (
  SELECT a.user_id,a.display_name,goliath_api.scope_organisation(a.scope_type,a.scope_id) AS organisation_id
  FROM public.ec_responsibility_assignments a
  WHERE a.active=1
  UNION
  SELECT m.user_id,m.display_name,p.organisation_id
  FROM public.pc_project_members m JOIN public.pc_projects p ON p.id=m.project_id
  WHERE m.active=1
), resolved AS (
  SELECT organisation_id,user_id,max(display_name) AS display_name
  FROM people WHERE organisation_id IS NOT NULL GROUP BY organisation_id,user_id
)
INSERT INTO platform_identity.organisation_memberships(
  id,organisation_id,user_id,display_name,contact_email,status,created_by
)
SELECT 'OM-'||substr(md5(organisation_id||'|'||user_id),1,24),organisation_id,user_id,display_name,
  (SELECT ul.email FROM platform_identity.user_links ul WHERE ul.user_id=r.user_id AND ul.active=1 LIMIT 1),
  'active','migration'
FROM resolved r
ON CONFLICT (organisation_id,user_id) DO UPDATE SET
  display_name=EXCLUDED.display_name,
  contact_email=COALESCE(platform_identity.organisation_memberships.contact_email,EXCLUDED.contact_email),
  updated_at=now();

-- A team name reused across projects in the same organisation becomes one reusable team.
WITH labels AS (
  SELECT DISTINCT p.organisation_id,trim(m.team_id) AS team_label
  FROM public.pc_project_members m JOIN public.pc_projects p ON p.id=m.project_id
  WHERE m.team_id IS NOT NULL AND trim(m.team_id)<>''
)
INSERT INTO public.ec_teams(id,organisation_id,code,name,created_by)
SELECT 'TEAM-'||substr(md5(organisation_id||'|'||lower(team_label)),1,20),organisation_id,
  lower(regexp_replace(team_label,'[^a-zA-Z0-9]+','-','g')),team_label,'migration'
FROM labels
ON CONFLICT (organisation_id,code) DO NOTHING;

INSERT INTO public.ec_team_memberships(
  id,team_id,organisation_membership_id,membership_type,active,effective_from,assigned_by,reason
)
SELECT 'TM-'||substr(md5(t.id||'|'||om.id),1,24),t.id,om.id,
  CASE WHEN bool_or(m.role IN ('delivery-lead','agile-delivery-lead')) THEN 'manager' ELSE 'member' END,
  1,now(),'migration','Backfilled from governed project membership.'
FROM public.pc_project_members m
JOIN public.pc_projects p ON p.id=m.project_id
JOIN public.ec_teams t ON t.organisation_id=p.organisation_id AND lower(t.name)=lower(trim(m.team_id))
JOIN platform_identity.organisation_memberships om ON om.organisation_id=p.organisation_id AND om.user_id=m.user_id
WHERE m.active=1 AND m.team_id IS NOT NULL AND trim(m.team_id)<>''
GROUP BY t.id,om.id
ON CONFLICT (team_id,organisation_membership_id) DO UPDATE SET active=1,effective_to=NULL,revision=public.ec_team_memberships.revision+1;

INSERT INTO public.pc_project_memberships(
  id,project_id,organisation_membership_id,status,admission_source,joined_at,assigned_by
)
SELECT 'PMEM-'||substr(md5(m.project_id||'|'||om.id),1,22),m.project_id,om.id,
  CASE WHEN m.active=1 THEN 'active' ELSE 'inactive' END,'legacy',COALESCE(NULLIF(m.joined_at,'')::timestamptz,now()),'migration'
FROM public.pc_project_members m
JOIN public.pc_projects p ON p.id=m.project_id
JOIN platform_identity.organisation_memberships om ON om.organisation_id=p.organisation_id AND om.user_id=m.user_id
ON CONFLICT (project_id,organisation_membership_id) DO UPDATE SET
  status=EXCLUDED.status,ended_at=CASE WHEN EXCLUDED.status='inactive' THEN now() ELSE NULL END,
  revision=public.pc_project_memberships.revision+1;

INSERT INTO public.pc_project_team_assignments(
  id,project_id,team_id,access_role,active,effective_from,assigned_by,reason
)
SELECT 'PTA-'||substr(md5(m.project_id||'|'||t.id),1,23),m.project_id,t.id,'team-member',1,now(),'migration',
  'Backfilled from existing project team labels.'
FROM public.pc_project_members m
JOIN public.pc_projects p ON p.id=m.project_id
JOIN public.ec_teams t ON t.organisation_id=p.organisation_id AND lower(t.name)=lower(trim(m.team_id))
WHERE m.active=1 AND m.team_id IS NOT NULL AND trim(m.team_id)<>''
GROUP BY m.project_id,t.id
ON CONFLICT (project_id,team_id) DO UPDATE SET active=1,effective_to=NULL,revision=public.pc_project_team_assignments.revision+1;

INSERT INTO public.ec_responsibility_sources(
  id,responsibility_id,source_type,source_id,active,granted_by,granted_at
)
SELECT 'RS-'||substr(md5(a.id||'|legacy'),1,25),a.id,'legacy',a.id,1,'migration',now()
FROM public.ec_responsibility_assignments a
WHERE a.active=1 AND NOT EXISTS(
  SELECT 1 FROM public.ec_responsibility_sources s
  WHERE s.responsibility_id=a.id AND s.active=1
)
ON CONFLICT DO NOTHING;

-- Project administration is access administration, not delivery authority.
ALTER TABLE public.ec_responsibility_assignments DROP CONSTRAINT IF EXISTS ec_responsibility_assignments_role_check;
ALTER TABLE public.ec_responsibility_assignments ADD CONSTRAINT ec_responsibility_assignments_role_check CHECK (
  role IN ('sponsor','portfolio-manager','program-manager','project-director','project-manager','project-admin','pmo','resource-manager','delivery-lead','agile-delivery-lead','team-member','enterprise-admin')
);
ALTER TABLE public.pc_project_members DROP CONSTRAINT IF EXISTS pc_project_members_role_check;
ALTER TABLE public.pc_project_members ADD CONSTRAINT pc_project_members_role_check CHECK (
  role IN ('sponsor','portfolio-manager','program-manager','project-director','project-manager','project-admin','pmo','resource-manager','delivery-lead','agile-delivery-lead','team-member','enterprise-admin')
);

INSERT INTO platform_identity.role_catalog(
  role_key,display_name,default_scope_type,purpose,requires_team,surfaces_json,active,sort_order
) VALUES(
  'project-admin','Project Admin','project','Administer project membership, team assignment and project-scoped access without inheriting delivery authority.',0,'["administration"]',1,45
)
ON CONFLICT (role_key) DO UPDATE SET
  display_name=EXCLUDED.display_name,default_scope_type=EXCLUDED.default_scope_type,
  purpose=EXCLUDED.purpose,requires_team=EXCLUDED.requires_team,
  surfaces_json=EXCLUDED.surfaces_json,active=1,sort_order=EXCLUDED.sort_order;

INSERT INTO public.ec_role_data_class_defaults(role,data_class,can_read,can_write,rationale) VALUES
  ('project-admin','delivery',0,0,'Project access administration does not imply project-delivery visibility.'),
  ('project-admin','audit',0,0,'Project Admin receives only the access records returned by project-scoped administration APIs.')
ON CONFLICT (role,data_class) DO UPDATE SET
  can_read=EXCLUDED.can_read,can_write=EXCLUDED.can_write,rationale=EXCLUDED.rationale;

INSERT INTO platform_identity.role_action_policy(role_key,object_type,action,authority_mode,condition_code,notes,active)
SELECT 'project-admin',a.object_type,a.action,
  CASE WHEN a.object_type='responsibility' AND a.action IN ('grant','revoke') THEN 'allow' ELSE 'deny' END,
  CASE WHEN a.object_type='responsibility' AND a.action IN ('grant','revoke') THEN 'project-scope-only' ELSE NULL END,
  CASE WHEN a.object_type='responsibility' AND a.action IN ('grant','revoke')
    THEN 'Project-scoped membership, team and access administration only.'
    ELSE 'Project Admin does not inherit delivery or organisation authority.' END,1
FROM platform_identity.action_catalog a
ON CONFLICT (role_key,object_type,action) DO UPDATE SET
  authority_mode=EXCLUDED.authority_mode,condition_code=EXCLUDED.condition_code,notes=EXCLUDED.notes,active=1;

CREATE OR REPLACE FUNCTION goliath_api.access_admin_context(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_org text; v_project text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  IF c->>'role'='enterprise-admin' AND c->>'scopeType'='organisation' THEN
    v_org:=c->>'scopeId';
  ELSIF c->>'role'='project-admin' AND c->>'scopeType'='project' THEN
    v_project:=c->>'scopeId';
    SELECT organisation_id INTO v_org FROM public.pc_projects WHERE id=v_project;
    IF v_org IS NULL THEN RAISE EXCEPTION 'Project administration scope is invalid.' USING ERRCODE='42501'; END IF;
  ELSE
    RAISE EXCEPTION 'Organisation Admin or Project Admin authority is required.' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('userId',c->>'userId','role',c->>'role','organisationId',v_org,'projectId',v_project,
    'canManageOrganisation',(c->>'role'='enterprise-admin'));
END
$$;

REVOKE ALL ON FUNCTION goliath_api.access_admin_context(text) FROM PUBLIC,authenticated,goliath_web_anon;

CREATE OR REPLACE FUNCTION goliath_api.ensure_project_responsibility(
  p_user_id text,p_display_name text,p_role text,p_project_id text,p_team_id text,
  p_source_type text,p_source_id text,p_granted_by text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','goliath_api'
AS $$
DECLARE v_id text; v_at text:=clock_timestamp()::text;
BEGIN
  SELECT id INTO v_id FROM public.ec_responsibility_assignments
  WHERE user_id=p_user_id AND role=p_role AND scope_type='project' AND scope_id=p_project_id
    AND COALESCE(team_id,'')=COALESCE(p_team_id,'') AND active=1 LIMIT 1;
  IF v_id IS NULL THEN
    v_id:='CTX-'||replace(gen_random_uuid()::text,'-','');
    INSERT INTO public.ec_responsibility_assignments(
      id,user_id,display_name,role,scope_type,scope_id,team_id,active,permissions_json,
      effective_from,effective_to,granted_by,granted_at,revision
    ) VALUES(v_id,p_user_id,p_display_name,p_role,'project',p_project_id,p_team_id,1,'[]',v_at,NULL,p_granted_by,v_at,1);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ec_responsibility_sources
    WHERE responsibility_id=v_id AND source_type=p_source_type AND source_id=p_source_id AND active=1) THEN
    INSERT INTO public.ec_responsibility_sources(
      id,responsibility_id,source_type,source_id,active,granted_by,granted_at
    ) VALUES('RS-'||replace(gen_random_uuid()::text,'-',''),v_id,p_source_type,p_source_id,1,p_granted_by,now());
  END IF;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION goliath_api.ensure_project_responsibility(text,text,text,text,text,text,text,text) FROM PUBLIC,authenticated,goliath_web_anon;

CREATE OR REPLACE FUNCTION goliath_api.refresh_sourced_responsibilities()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','goliath_api'
AS $$
  UPDATE public.ec_responsibility_assignments a
  SET active=0,effective_to=COALESCE(effective_to,clock_timestamp()::text),
      revoked_at=COALESCE(revoked_at,clock_timestamp()::text),
      revocation_reason=COALESCE(revocation_reason,'All access sources were removed.'),revision=revision+1
  WHERE a.active=1
    AND EXISTS(SELECT 1 FROM public.ec_responsibility_sources x WHERE x.responsibility_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM public.ec_responsibility_sources x WHERE x.responsibility_id=a.id AND x.active=1)
$$;

REVOKE ALL ON FUNCTION goliath_api.refresh_sourced_responsibilities() FROM PUBLIC,authenticated,goliath_web_anon;

CREATE OR REPLACE FUNCTION goliath_api.admin_add_organisation_member(
  p_acting_assignment_id text,p_display_name text,p_contact_email text DEFAULT NULL,p_user_id text DEFAULT NULL,p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb; v_user text; v_id text;
BEGIN
  ac:=goliath_api.access_admin_context(p_acting_assignment_id);
  IF NOT (ac->>'canManageOrganisation')::boolean THEN RAISE EXCEPTION 'Organisation Admin authority is required.' USING ERRCODE='42501'; END IF;
  IF COALESCE(trim(p_display_name),'')='' THEN RAISE EXCEPTION 'Display name is required.' USING ERRCODE='22023'; END IF;
  v_user:=COALESCE(NULLIF(trim(p_user_id),''),'USR-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)));
  v_id:='OM-'||substr(md5((ac->>'organisationId')||'|'||v_user),1,24);
  INSERT INTO platform_identity.organisation_memberships(
    id,organisation_id,user_id,display_name,contact_email,status,created_by
  ) VALUES(v_id,ac->>'organisationId',v_user,trim(p_display_name),NULLIF(lower(trim(p_contact_email)),''),'active',ac->>'userId')
  ON CONFLICT (organisation_id,user_id) DO UPDATE SET
    display_name=EXCLUDED.display_name,contact_email=COALESCE(EXCLUDED.contact_email,platform_identity.organisation_memberships.contact_email),
    status='active',ended_at=NULL,updated_at=now(),revision=platform_identity.organisation_memberships.revision+1
  RETURNING id INTO v_id;
  PERFORM goliath_api.append_context_event(ac->>'userId','organisation.member.saved',v_id,'organisation',ac->>'organisationId','allowed',
    COALESCE(NULLIF(trim(p_reason),''),'Organisation membership created or reactivated.'),jsonb_build_object('userId',v_user));
  RETURN jsonb_build_object('membershipId',v_id,'userId',v_user,'displayName',trim(p_display_name),'status','active');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_create_team(
  p_acting_assignment_id text,p_name text,p_code text DEFAULT NULL,p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb; v_code text; v_id text;
BEGIN
  ac:=goliath_api.access_admin_context(p_acting_assignment_id);
  IF NOT (ac->>'canManageOrganisation')::boolean THEN RAISE EXCEPTION 'Organisation Admin authority is required.' USING ERRCODE='42501'; END IF;
  IF COALESCE(trim(p_name),'')='' THEN RAISE EXCEPTION 'Team name is required.' USING ERRCODE='22023'; END IF;
  v_code:=lower(regexp_replace(COALESCE(NULLIF(trim(p_code),''),trim(p_name)),'[^a-zA-Z0-9]+','-','g'));
  v_code:=trim(both '-' from v_code);
  IF v_code='' THEN RAISE EXCEPTION 'A usable team code is required.' USING ERRCODE='22023'; END IF;
  SELECT id INTO v_id FROM public.ec_teams WHERE organisation_id=ac->>'organisationId' AND code=v_code;
  IF v_id IS NULL THEN
    v_id:='TEAM-'||replace(gen_random_uuid()::text,'-','');
    INSERT INTO public.ec_teams(id,organisation_id,code,name,status,created_by)
    VALUES(v_id,ac->>'organisationId',v_code,trim(p_name),'active',ac->>'userId');
  ELSE
    UPDATE public.ec_teams SET name=trim(p_name),status='active',updated_at=now(),revision=revision+1 WHERE id=v_id;
  END IF;
  PERFORM goliath_api.append_context_event(ac->>'userId','team.saved',v_id,'organisation',ac->>'organisationId','allowed',
    COALESCE(NULLIF(trim(p_reason),''),'Team created or reactivated.'),jsonb_build_object('teamId',v_id,'code',v_code));
  RETURN jsonb_build_object('id',v_id,'code',v_code,'name',trim(p_name),'status','active');
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_assign_person(
  p_acting_assignment_id text,p_user_id text,p_team_id text,p_project_ids text[],p_role text,
  p_mode text DEFAULT 'add',p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb; om platform_identity.organisation_memberships%ROWTYPE; v_project text; v_resp text;
  v_source text; v_team_name text; v_count integer:=0; v_tm_id text;
BEGIN
  ac:=goliath_api.access_admin_context(p_acting_assignment_id);
  IF p_mode NOT IN ('add','replace') THEN RAISE EXCEPTION 'Mode must be add or replace.' USING ERRCODE='22023'; END IF;
  IF p_role NOT IN ('project-admin','project-manager','sponsor','pmo','delivery-lead','agile-delivery-lead','team-member') THEN
    RAISE EXCEPTION 'Choose a supported project responsibility.' USING ERRCODE='22023';
  END IF;
  IF NOT (ac->>'canManageOrganisation')::boolean AND p_role='project-admin' THEN
    RAISE EXCEPTION 'Only an Organisation Admin may appoint another Project Admin.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO om FROM platform_identity.organisation_memberships
  WHERE organisation_id=ac->>'organisationId' AND user_id=p_user_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active member of this organisation.' USING ERRCODE='22023'; END IF;
  IF COALESCE(array_length(p_project_ids,1),0)=0 THEN RAISE EXCEPTION 'Choose at least one project.' USING ERRCODE='22023'; END IF;
  IF ac->>'projectId' IS NOT NULL AND (array_length(p_project_ids,1)<>1 OR p_project_ids[1]<>ac->>'projectId') THEN
    RAISE EXCEPTION 'Project Admin may manage only the assigned project.' USING ERRCODE='42501';
  END IF;
  IF p_team_id IS NOT NULL THEN
    SELECT name INTO v_team_name FROM public.ec_teams WHERE id=p_team_id AND organisation_id=ac->>'organisationId' AND status='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active team in this organisation.' USING ERRCODE='22023'; END IF;
    IF NOT (ac->>'canManageOrganisation')::boolean AND NOT EXISTS(
      SELECT 1 FROM public.pc_project_team_assignments x WHERE x.team_id=p_team_id AND x.project_id=ac->>'projectId' AND x.active=1
    ) THEN RAISE EXCEPTION 'Project Admin may use only teams already shared with this project.' USING ERRCODE='42501'; END IF;
  END IF;

  IF p_mode='replace' THEN
    UPDATE public.ec_responsibility_sources s SET active=0,revoked_by=ac->>'userId',revoked_at=now(),
      revocation_reason=COALESCE(NULLIF(trim(p_reason),''),'Replaced by a new direct assignment.'),revision=revision+1
    FROM public.ec_responsibility_assignments a, public.pc_projects p
    WHERE s.responsibility_id=a.id AND s.active=1 AND s.source_type IN ('direct','legacy')
      AND a.user_id=p_user_id AND a.scope_type='project' AND p.id=a.scope_id AND p.organisation_id=ac->>'organisationId'
      AND (ac->>'projectId' IS NULL OR p.id=ac->>'projectId')
      AND (NOT p.id=ANY(p_project_ids) OR a.role<>p_role OR COALESCE(a.team_id,'')<>COALESCE(p_team_id,''));
    IF p_team_id IS NOT NULL AND (ac->>'canManageOrganisation')::boolean THEN
      UPDATE public.ec_team_memberships tm SET active=0,effective_to=now(),revision=revision+1,
        reason=COALESCE(NULLIF(trim(p_reason),''),'Moved to another team.')
      FROM public.ec_teams t
      WHERE tm.team_id=t.id AND tm.organisation_membership_id=om.id AND tm.active=1
        AND t.organisation_id=ac->>'organisationId' AND tm.team_id<>p_team_id;
      UPDATE public.ec_responsibility_sources s SET active=0,revoked_by=ac->>'userId',revoked_at=now(),
        revocation_reason=COALESCE(NULLIF(trim(p_reason),''),'Team membership was reassigned.'),revision=revision+1
      FROM public.ec_responsibility_assignments a, public.pc_project_team_assignments pta
      WHERE s.responsibility_id=a.id AND s.active=1 AND s.source_type='team-project-assignment'
        AND s.source_id=pta.id AND a.user_id=p_user_id AND pta.team_id<>p_team_id;
    END IF;
    PERFORM goliath_api.refresh_sourced_responsibilities();
    UPDATE public.pc_project_memberships pm SET status='inactive',ended_at=now(),revision=pm.revision+1
    FROM public.pc_projects p
    WHERE pm.organisation_membership_id=om.id AND pm.project_id=p.id AND pm.status='active'
      AND p.organisation_id=ac->>'organisationId' AND (ac->>'projectId' IS NULL OR p.id=ac->>'projectId')
      AND NOT p.id=ANY(p_project_ids)
      AND NOT EXISTS(SELECT 1 FROM public.ec_responsibility_assignments a
        WHERE a.user_id=p_user_id AND a.scope_type='project' AND a.scope_id=p.id AND a.active=1)
      AND NOT EXISTS(SELECT 1 FROM public.ec_team_memberships tm JOIN public.pc_project_team_assignments pta ON pta.team_id=tm.team_id
        WHERE tm.organisation_membership_id=om.id AND tm.active=1 AND pta.project_id=p.id AND pta.active=1);
    UPDATE public.pc_project_members m SET active=0
    FROM public.pc_projects p
    WHERE m.user_id=p_user_id AND m.project_id=p.id AND m.active=1
      AND p.organisation_id=ac->>'organisationId' AND (ac->>'projectId' IS NULL OR p.id=ac->>'projectId')
      AND NOT p.id=ANY(p_project_ids)
      AND NOT EXISTS(SELECT 1 FROM public.ec_responsibility_assignments a
        WHERE a.user_id=p_user_id AND a.scope_type='project' AND a.scope_id=p.id AND a.active=1)
      AND NOT EXISTS(SELECT 1 FROM public.ec_team_memberships tm JOIN platform_identity.organisation_memberships x ON x.id=tm.organisation_membership_id
        JOIN public.pc_project_team_assignments pta ON pta.team_id=tm.team_id
        WHERE x.user_id=p_user_id AND tm.active=1 AND pta.project_id=p.id AND pta.active=1);
  END IF;

  IF p_team_id IS NOT NULL THEN
    SELECT id INTO v_tm_id FROM public.ec_team_memberships WHERE team_id=p_team_id AND organisation_membership_id=om.id;
    IF v_tm_id IS NULL THEN
      v_tm_id:='TM-'||replace(gen_random_uuid()::text,'-','');
      INSERT INTO public.ec_team_memberships(id,team_id,organisation_membership_id,membership_type,active,assigned_by,reason)
      VALUES(v_tm_id,p_team_id,om.id,CASE WHEN p_role IN ('delivery-lead','agile-delivery-lead') THEN 'manager' ELSE 'member' END,1,ac->>'userId',p_reason);
    ELSE
      UPDATE public.ec_team_memberships SET active=1,effective_to=NULL,
        membership_type=CASE WHEN p_role IN ('delivery-lead','agile-delivery-lead') THEN 'manager' ELSE membership_type END,
        assigned_by=ac->>'userId',reason=p_reason,revision=revision+1 WHERE id=v_tm_id;
    END IF;
  END IF;

  FOREACH v_project IN ARRAY p_project_ids LOOP
    IF NOT EXISTS(SELECT 1 FROM public.pc_projects WHERE id=v_project AND organisation_id=ac->>'organisationId') THEN
      RAISE EXCEPTION 'A selected project is outside this organisation.' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.pc_project_memberships(id,project_id,organisation_membership_id,status,admission_source,assigned_by)
    VALUES('PMEM-'||replace(gen_random_uuid()::text,'-',''),v_project,om.id,'active',CASE WHEN p_team_id IS NULL THEN 'direct' ELSE 'team' END,ac->>'userId')
    ON CONFLICT (project_id,organisation_membership_id) DO UPDATE SET status='active',ended_at=NULL,
      admission_source=EXCLUDED.admission_source,assigned_by=EXCLUDED.assigned_by,revision=public.pc_project_memberships.revision+1;
    INSERT INTO public.pc_project_members(project_id,user_id,display_name,role,team_id,active,permissions_json,joined_at)
    VALUES(v_project,p_user_id,om.display_name,p_role,p_team_id,1,'[]',clock_timestamp()::text)
    ON CONFLICT (project_id,user_id) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,
      team_id=EXCLUDED.team_id,active=1;
    v_source:='direct:'||p_user_id||':'||v_project||':'||p_role||':'||COALESCE(p_team_id,'none');
    v_resp:=goliath_api.ensure_project_responsibility(p_user_id,om.display_name,p_role,v_project,p_team_id,'direct',v_source,ac->>'userId');
    v_count:=v_count+1;
  END LOOP;
  PERFORM goliath_api.append_context_event(ac->>'userId','access.person.assigned',p_user_id,'organisation',ac->>'organisationId','allowed',
    COALESCE(NULLIF(trim(p_reason),''),CASE WHEN p_mode='replace' THEN 'Person reassigned.' ELSE 'Person shared with additional projects.' END),
    jsonb_build_object('projectIds',p_project_ids,'role',p_role,'teamId',p_team_id,'mode',p_mode));
  RETURN jsonb_build_object('userId',p_user_id,'projectsAssigned',v_count,'role',p_role,'teamId',p_team_id,'mode',p_mode);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_assign_team(
  p_acting_assignment_id text,p_team_id text,p_project_ids text[],p_role text DEFAULT 'team-member',
  p_mode text DEFAULT 'add',p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb; t public.ec_teams%ROWTYPE; v_project text; v_pta text; m record; v_count integer:=0;
BEGIN
  ac:=goliath_api.access_admin_context(p_acting_assignment_id);
  IF p_mode NOT IN ('add','replace') THEN RAISE EXCEPTION 'Mode must be add or replace.' USING ERRCODE='22023'; END IF;
  IF p_role NOT IN ('delivery-lead','agile-delivery-lead','team-member') THEN RAISE EXCEPTION 'Choose a team access role.' USING ERRCODE='22023'; END IF;
  SELECT * INTO t FROM public.ec_teams WHERE id=p_team_id AND organisation_id=ac->>'organisationId' AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active team in this organisation.' USING ERRCODE='22023'; END IF;
  IF COALESCE(array_length(p_project_ids,1),0)=0 THEN RAISE EXCEPTION 'Choose at least one project.' USING ERRCODE='22023'; END IF;
  IF ac->>'projectId' IS NOT NULL AND (array_length(p_project_ids,1)<>1 OR p_project_ids[1]<>ac->>'projectId') THEN
    RAISE EXCEPTION 'Project Admin may manage only the assigned project.' USING ERRCODE='42501';
  END IF;
  IF p_mode='replace' THEN
    UPDATE public.pc_project_team_assignments pta SET active=0,effective_to=now(),assigned_by=ac->>'userId',
      reason=COALESCE(NULLIF(trim(p_reason),''),'Team project sharing replaced.'),revision=revision+1
    FROM public.pc_projects p WHERE pta.project_id=p.id AND pta.team_id=p_team_id AND pta.active=1
      AND p.organisation_id=ac->>'organisationId' AND (ac->>'projectId' IS NULL OR p.id=ac->>'projectId')
      AND NOT p.id=ANY(p_project_ids);
    UPDATE public.ec_responsibility_sources s SET active=0,revoked_by=ac->>'userId',revoked_at=now(),
      revocation_reason=COALESCE(NULLIF(trim(p_reason),''),'Team was removed from the project.'),revision=revision+1
    FROM public.pc_project_team_assignments pta
    WHERE s.source_type='team-project-assignment' AND s.source_id=pta.id AND s.active=1 AND pta.team_id=p_team_id AND pta.active=0;
    UPDATE public.ec_responsibility_sources s SET active=0,revoked_by=ac->>'userId',revoked_at=now(),
      revocation_reason=COALESCE(NULLIF(trim(p_reason),''),'Legacy team access was replaced.'),revision=revision+1
    FROM public.ec_responsibility_assignments a, public.pc_project_team_assignments pta,
      public.ec_team_memberships tm, platform_identity.organisation_memberships om
    WHERE s.responsibility_id=a.id AND s.source_type='legacy' AND s.active=1
      AND pta.team_id=p_team_id AND pta.active=0 AND a.scope_type='project' AND a.scope_id=pta.project_id
      AND tm.team_id=p_team_id AND tm.active=1 AND om.id=tm.organisation_membership_id AND om.user_id=a.user_id
      AND COALESCE(a.team_id,'') IN (p_team_id,t.name,t.code);
    PERFORM goliath_api.refresh_sourced_responsibilities();
  END IF;
  FOREACH v_project IN ARRAY p_project_ids LOOP
    IF NOT EXISTS(SELECT 1 FROM public.pc_projects WHERE id=v_project AND organisation_id=ac->>'organisationId') THEN
      RAISE EXCEPTION 'A selected project is outside this organisation.' USING ERRCODE='42501';
    END IF;
    SELECT id INTO v_pta FROM public.pc_project_team_assignments WHERE project_id=v_project AND team_id=p_team_id;
    IF v_pta IS NULL THEN
      v_pta:='PTA-'||replace(gen_random_uuid()::text,'-','');
      INSERT INTO public.pc_project_team_assignments(id,project_id,team_id,access_role,active,assigned_by,reason)
      VALUES(v_pta,v_project,p_team_id,p_role,1,ac->>'userId',p_reason);
    ELSE
      UPDATE public.ec_responsibility_sources SET active=0,revoked_by=ac->>'userId',revoked_at=now(),
        revocation_reason='Team project role was refreshed.',revision=revision+1
      WHERE source_type='team-project-assignment' AND source_id=v_pta AND active=1;
      UPDATE public.ec_responsibility_sources s SET active=0,revoked_by=ac->>'userId',revoked_at=now(),
        revocation_reason='Legacy team project role was refreshed.',revision=revision+1
      FROM public.ec_responsibility_assignments a, public.ec_team_memberships tm,
        platform_identity.organisation_memberships om
      WHERE s.responsibility_id=a.id AND s.source_type='legacy' AND s.active=1
        AND a.scope_type='project' AND a.scope_id=v_project AND COALESCE(a.team_id,'') IN (p_team_id,t.name,t.code)
        AND tm.team_id=p_team_id AND tm.active=1 AND om.id=tm.organisation_membership_id AND om.user_id=a.user_id;
      UPDATE public.pc_project_team_assignments SET access_role=p_role,active=1,effective_to=NULL,
        assigned_by=ac->>'userId',reason=p_reason,revision=revision+1 WHERE id=v_pta;
      PERFORM goliath_api.refresh_sourced_responsibilities();
    END IF;
    FOR m IN
      SELECT om.* FROM public.ec_team_memberships tm
      JOIN platform_identity.organisation_memberships om ON om.id=tm.organisation_membership_id
      WHERE tm.team_id=p_team_id AND tm.active=1 AND om.status='active'
    LOOP
      INSERT INTO public.pc_project_memberships(id,project_id,organisation_membership_id,status,admission_source,assigned_by)
      VALUES('PMEM-'||replace(gen_random_uuid()::text,'-',''),v_project,m.id,'active','team',ac->>'userId')
      ON CONFLICT (project_id,organisation_membership_id) DO UPDATE SET status='active',ended_at=NULL,
        admission_source='team',assigned_by=EXCLUDED.assigned_by,revision=public.pc_project_memberships.revision+1;
      INSERT INTO public.pc_project_members(project_id,user_id,display_name,role,team_id,active,permissions_json,joined_at)
      VALUES(v_project,m.user_id,m.display_name,p_role,p_team_id,1,'[]',clock_timestamp()::text)
      ON CONFLICT (project_id,user_id) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,team_id=EXCLUDED.team_id,active=1;
      PERFORM goliath_api.ensure_project_responsibility(m.user_id,m.display_name,p_role,v_project,p_team_id,
        'team-project-assignment',v_pta,ac->>'userId');
    END LOOP;
    v_count:=v_count+1;
  END LOOP;
  PERFORM goliath_api.append_context_event(ac->>'userId','access.team.assigned',p_team_id,'organisation',ac->>'organisationId','allowed',
    COALESCE(NULLIF(trim(p_reason),''),CASE WHEN p_mode='replace' THEN 'Team project sharing replaced.' ELSE 'Team shared with additional projects.' END),
    jsonb_build_object('projectIds',p_project_ids,'role',p_role,'mode',p_mode));
  RETURN jsonb_build_object('teamId',p_team_id,'projectsAssigned',v_count,'role',p_role,'mode',p_mode);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.access_management_state(p_acting_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb; v_org text; v_project text;
BEGIN
  ac:=goliath_api.access_admin_context(p_acting_assignment_id);v_org:=ac->>'organisationId';v_project:=ac->>'projectId';
  RETURN jsonb_build_object(
    'authority',ac,
    'organisation',(SELECT jsonb_build_object('id',id,'name',name,'code',code) FROM public.ec_organisations WHERE id=v_org),
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code,'lifecycle',p.lifecycle) ORDER BY p.name)
      FROM public.pc_projects p WHERE p.organisation_id=v_org AND (v_project IS NULL OR p.id=v_project)),'[]'::jsonb),
    'users',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'membershipId',om.id,'userId',om.user_id,'displayName',om.display_name,'email',CASE WHEN (ac->>'canManageOrganisation')::boolean THEN COALESCE(ul.email,om.contact_email) ELSE NULL END,
      'status',om.status,'identityLinked',ul.user_id IS NOT NULL,
      'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'membershipType',tm.membership_type) ORDER BY t.name)
        FROM public.ec_team_memberships tm JOIN public.ec_teams t ON t.id=tm.team_id WHERE tm.organisation_membership_id=om.id AND tm.active=1),'[]'::jsonb),
      'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'status',pm.status) ORDER BY p.name)
        FROM public.pc_project_memberships pm JOIN public.pc_projects p ON p.id=pm.project_id
        WHERE pm.organisation_membership_id=om.id AND pm.status='active' AND (v_project IS NULL OR p.id=v_project)),'[]'::jsonb)
    ) ORDER BY om.display_name)
    FROM platform_identity.organisation_memberships om
    LEFT JOIN platform_identity.user_links ul ON ul.user_id=om.user_id AND ul.active=1
    WHERE om.organisation_id=v_org AND om.status IN ('invited','active')),'[]'::jsonb),
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',t.id,'code',t.code,'name',t.name,'status',t.status,
      'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',om.user_id,'displayName',om.display_name,'membershipType',tm.membership_type) ORDER BY om.display_name)
        FROM public.ec_team_memberships tm JOIN platform_identity.organisation_memberships om ON om.id=tm.organisation_membership_id
        WHERE tm.team_id=t.id AND tm.active=1 AND om.status='active'),'[]'::jsonb),
      'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',pta.access_role) ORDER BY p.name)
        FROM public.pc_project_team_assignments pta JOIN public.pc_projects p ON p.id=pta.project_id
        WHERE pta.team_id=t.id AND pta.active=1 AND (v_project IS NULL OR p.id=v_project)),'[]'::jsonb)
    ) ORDER BY t.name) FROM public.ec_teams t WHERE t.organisation_id=v_org AND t.status='active'),'[]'::jsonb),
    'assignments',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'userId',a.user_id,'displayName',a.display_name,'role',a.role,'scopeType',a.scope_type,'scopeId',a.scope_id,
      'teamId',a.team_id,'teamName',t.name,'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'type',s.source_type,'sourceId',s.source_id) ORDER BY s.granted_at)
        FROM public.ec_responsibility_sources s WHERE s.responsibility_id=a.id AND s.active=1),'[]'::jsonb)
    ) ORDER BY a.display_name,a.scope_id,a.role)
    FROM public.ec_responsibility_assignments a LEFT JOIN public.ec_teams t ON t.id=a.team_id
    WHERE a.active=1 AND goliath_api.scope_organisation(a.scope_type,a.scope_id)=v_org
      AND (v_project IS NULL OR (a.scope_type='project' AND a.scope_id=v_project))),'[]'::jsonb)
  );
END
$$;

REVOKE ALL ON FUNCTION goliath_api.admin_add_organisation_member(text,text,text,text,text) FROM PUBLIC,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.admin_create_team(text,text,text,text) FROM PUBLIC,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.admin_assign_person(text,text,text,text[],text,text,text) FROM PUBLIC,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.admin_assign_team(text,text,text[],text,text,text) FROM PUBLIC,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.access_management_state(text) FROM PUBLIC,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.admin_add_organisation_member(text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.admin_create_team(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.admin_assign_person(text,text,text,text[],text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.admin_assign_team(text,text,text[],text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.access_management_state(text) TO authenticated;

-- Keep Project Admin contexts administrative-only in the existing home projection.
CREATE OR REPLACE FUNCTION goliath_api.control_home(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; nav jsonb; v_role text; projects jsonb; mine jsonb; decisions jsonb; deps jsonb; debt jsonb; notes jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);v_role:=c->>'role';nav:=goliath_api.mvp_navigation(p_assignment_id);
  projects:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','project-admin') THEN '[]'::jsonb ELSE goliath_api.scoped_project_list(p_assignment_id) END;
  mine:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','project-admin','sponsor','portfolio-manager') THEN '[]'::jsonb ELSE goliath_api.my_commitments(p_assignment_id) END;
  decisions:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','project-admin','portfolio-manager') THEN '[]'::jsonb ELSE goliath_api.decision_queue(p_assignment_id) END;
  deps:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','project-admin','portfolio-manager','sponsor') THEN '[]'::jsonb ELSE goliath_api.dependency_queue(p_assignment_id) END;
  debt:=CASE WHEN v_role IN ('enterprise-admin','resource-manager','project-admin') THEN NULL ELSE goliath_api.decision_debt_summary(p_assignment_id) END;
  notes:=CASE WHEN v_role IN ('enterprise-admin','project-admin') THEN '[]'::jsonb ELSE goliath_api.notification_queue(p_assignment_id) END;
  RETURN jsonb_build_object('identity',jsonb_build_object('userId',c->>'userId','displayName',c->>'displayName','role',v_role,'scopeType',c->>'scopeType','scopeId',c->>'scopeId','teamId',c->>'teamId'),
    'navigation',nav,'projects',projects,'myCommitments',mine,'decisions',decisions,'dependencies',deps,'decisionDebt',debt,'notifications',notes);
END
$$;

-- Tenant containment for existing Enterprise Admin reference reads.
CREATE OR REPLACE FUNCTION goliath_api.admin_reference_data(p_acting_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE c jsonb; v_org text;
BEGIN
  c:=goliath_api.require_context(p_acting_assignment_id);
  IF c->>'role'<>'enterprise-admin' OR c->>'scopeType'<>'organisation' THEN
    RAISE EXCEPTION 'Organisation Admin authority is required.' USING ERRCODE='42501';
  END IF;
  v_org:=c->>'scopeId';
  RETURN jsonb_build_object(
    'organisations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code)) FROM public.ec_organisations WHERE id=v_org),'[]'::jsonb),
    'portfolios',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.ec_portfolios WHERE organisation_id=v_org),'[]'::jsonb),
    'programs',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pg.id,'name',pg.name)) FROM public.ec_programs pg JOIN public.ec_portfolios pf ON pf.id=pg.portfolio_id WHERE pf.organisation_id=v_org),'[]'::jsonb),
    'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code) ORDER BY name) FROM public.pc_projects WHERE organisation_id=v_org),'[]'::jsonb),
    'orgUnits',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.ec_org_units WHERE organisation_id=v_org),'[]'::jsonb),
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('teamId',t.id,'name',t.name,'projectId',pta.project_id) ORDER BY t.name,pta.project_id)
      FROM public.ec_teams t LEFT JOIN public.pc_project_team_assignments pta ON pta.team_id=t.id AND pta.active=1
      WHERE t.organisation_id=v_org AND t.status='active'),'[]'::jsonb),
    'assignments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'userId',a.user_id,'displayName',a.display_name,'role',a.role,'scopeType',a.scope_type,'scopeId',a.scope_id,'teamId',a.team_id) ORDER BY a.display_name,a.role)
      FROM public.ec_responsibility_assignments a WHERE a.active=1 AND goliath_api.scope_organisation(a.scope_type,a.scope_id)=v_org),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_data_class_state(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb; v_org text;
BEGIN
  ac:=goliath_api.access_admin_context(p_assignment_id);
  IF NOT (ac->>'canManageOrganisation')::boolean THEN RAISE EXCEPTION 'Organisation Admin authority is required.' USING ERRCODE='42501'; END IF;
  v_org:=ac->>'organisationId';
  RETURN jsonb_build_object(
    'defaults',COALESCE((SELECT jsonb_agg(jsonb_build_object('role',d.role,'dataClass',d.data_class,
      'canRead',d.can_read=1,'canWrite',d.can_write=1,'rationale',d.rationale) ORDER BY d.role,d.data_class)
      FROM public.ec_role_data_class_defaults d),'[]'::jsonb),
    'overrides',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'assignmentId',o.assignment_id,
      'dataClass',o.data_class,'canRead',o.can_read=1,'canWrite',o.can_write=1,'reason',o.reason,
      'grantedBy',o.granted_by,'grantedAt',o.granted_at) ORDER BY o.granted_at DESC)
      FROM public.ec_data_class_overrides o JOIN public.ec_responsibility_assignments a ON a.id=o.assignment_id
      WHERE o.active=1 AND goliath_api.scope_organisation(a.scope_type,a.scope_id)=v_org),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_grant_responsibility(
  p_acting_assignment_id text,p_user_id text,p_role text,p_scope_type text,p_scope_id text,p_team_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb;
BEGIN
  ac:=goliath_api.access_admin_context(p_acting_assignment_id);
  IF NOT (ac->>'canManageOrganisation')::boolean THEN RAISE EXCEPTION 'Organisation Admin authority is required.' USING ERRCODE='42501'; END IF;
  IF goliath_api.scope_organisation(p_scope_type,p_scope_id) IS DISTINCT FROM ac->>'organisationId' THEN
    RAISE EXCEPTION 'Selected scope is outside this administrator organisation.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM platform_identity.organisation_memberships
    WHERE organisation_id=ac->>'organisationId' AND user_id=p_user_id AND status='active') THEN
    RAISE EXCEPTION 'Target user is not an active member of this organisation.' USING ERRCODE='42501';
  END IF;
  PERFORM goliath_api.require_capability(p_acting_assignment_id,'responsibility','grant');
  RETURN goliath_api._policy_admin_grant_responsibility(p_acting_assignment_id,p_user_id,p_role,p_scope_type,p_scope_id,p_team_id);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_revoke_responsibility(
  p_acting_assignment_id text,p_target_assignment_id text,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb; a public.ec_responsibility_assignments%ROWTYPE; v_count integer;
BEGIN
  ac:=goliath_api.access_admin_context(p_acting_assignment_id);
  IF NOT (ac->>'canManageOrganisation')::boolean THEN RAISE EXCEPTION 'Organisation Admin authority is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.ec_responsibility_assignments WHERE id=p_target_assignment_id AND active=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active responsibility not found.' USING ERRCODE='22023'; END IF;
  IF goliath_api.scope_organisation(a.scope_type,a.scope_id) IS DISTINCT FROM ac->>'organisationId' THEN
    RAISE EXCEPTION 'Target responsibility is outside this administrator organisation.' USING ERRCODE='42501';
  END IF;
  IF a.role='enterprise-admin' THEN
    SELECT count(*) INTO v_count FROM public.ec_responsibility_assignments x
    WHERE x.role='enterprise-admin' AND x.scope_type='organisation' AND x.scope_id=ac->>'organisationId' AND x.active=1;
    IF v_count<=1 THEN RAISE EXCEPTION 'Cannot revoke the last Organisation Admin for this organisation.' USING ERRCODE='42501'; END IF;
  END IF;
  PERFORM goliath_api.require_capability(p_acting_assignment_id,'responsibility','revoke');
  RETURN goliath_api._policy_admin_revoke_responsibility(p_acting_assignment_id,p_target_assignment_id,p_reason);
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.admin_set_data_class_override(
  p_acting_assignment_id text,p_target_assignment_id text,p_data_class text,
  p_can_read boolean,p_can_write boolean,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ac jsonb; a public.ec_responsibility_assignments%ROWTYPE;
BEGIN
  ac:=goliath_api.access_admin_context(p_acting_assignment_id);
  IF NOT (ac->>'canManageOrganisation')::boolean THEN RAISE EXCEPTION 'Organisation Admin authority is required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.ec_responsibility_assignments WHERE id=p_target_assignment_id AND active=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target responsibility is not active.' USING ERRCODE='22023'; END IF;
  IF goliath_api.scope_organisation(a.scope_type,a.scope_id) IS DISTINCT FROM ac->>'organisationId' THEN
    RAISE EXCEPTION 'Target responsibility is outside this administrator organisation.' USING ERRCODE='42501';
  END IF;
  PERFORM goliath_api.require_capability(p_acting_assignment_id,'access','data-class-override');
  RETURN goliath_api._policy_admin_set_data_class_override(p_acting_assignment_id,p_target_assignment_id,p_data_class,p_can_read,p_can_write,p_reason);
END
$$;

REVOKE ALL ON platform_identity.organisation_memberships,public.ec_teams,public.ec_team_memberships,
  public.pc_project_memberships,public.pc_project_team_assignments,public.ec_responsibility_sources
  FROM PUBLIC,authenticated,goliath_web_anon;

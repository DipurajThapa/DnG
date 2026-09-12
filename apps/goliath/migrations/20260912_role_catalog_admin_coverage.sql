-- Canonical Goliath role model and Enterprise Admin coverage projection.
-- This migration does not grant any user additional authority.

CREATE TABLE IF NOT EXISTS platform_identity.role_catalog (
  role_key text PRIMARY KEY,
  display_name text NOT NULL,
  default_scope_type text NOT NULL CHECK (default_scope_type IN ('organisation','portfolio','program','project','org-unit')),
  purpose text NOT NULL,
  requires_team integer NOT NULL DEFAULT 0 CHECK (requires_team IN (0,1)),
  surfaces_json text NOT NULL DEFAULT '[]',
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order integer NOT NULL
);

INSERT INTO platform_identity.role_catalog(role_key,display_name,default_scope_type,purpose,requires_team,surfaces_json,active,sort_order) VALUES
('enterprise-admin','Enterprise Admin','organisation','Administer organisation identities, responsibility contexts, data-class authority and platform configuration.',0,'["administration"]',1,10),
('portfolio-manager','Portfolio Manager','portfolio','Prioritise portfolio outcomes, investment and material exceptions.',0,'["attention","projects"]',1,20),
('program-manager','Program Manager','program','Control cross-project dependencies, major risks, decisions and program outcomes.',0,'["attention","projects","decisions","dependencies","raid","change","reports"]',1,30),
('project-director','Project Director','program','Direct authorised delivery across projects and consequential interventions.',0,'["attention","overview","commitments","requirements","decisions","dependencies","raid","change","reports"]',1,40),
('project-manager','Project Manager','project','Control commitments, evidence, exceptions, decisions, dependencies and forecasts for a project.',0,'["attention","overview","commitments","requirements","decisions","dependencies","raid","change","reports"]',1,50),
('pmo','PMO / Project Controls','organisation','Govern evidence quality, integration health, control consistency and cross-project assurance.',0,'["controls","projects","requirements","decisions","dependencies","raid","change","reports"]',1,60),
('resource-manager','Resource Manager','org-unit','Balance functional capacity against confirmed demand and approve allocations.',0,'["capacity"]',1,70),
('delivery-lead','Delivery Lead','project','Coordinate team delivery, blockers, dependencies and handoffs for a governed team.',1,'["my-commitments","decisions","dependencies"]',1,80),
('agile-delivery-lead','Agile Delivery Lead','project','Coordinate delivery flow and blockers without inheriting project-management authority.',1,'["my-commitments","decisions","dependencies"]',1,90),
('team-member','Team Member','project','Focus on owned commitments, evidence, dependencies and receiving handoffs.',1,'["my-commitments","decisions","dependencies"]',1,100),
('sponsor','Sponsor','project','Make consequential decisions and oversee outcome health and commitments.',0,'["decisions","overview","reports"]',1,110)
ON CONFLICT (role_key) DO UPDATE SET
  display_name=EXCLUDED.display_name,
  default_scope_type=EXCLUDED.default_scope_type,
  purpose=EXCLUDED.purpose,
  requires_team=EXCLUDED.requires_team,
  surfaces_json=EXCLUDED.surfaces_json,
  active=EXCLUDED.active,
  sort_order=EXCLUDED.sort_order;

REVOKE ALL ON platform_identity.role_catalog FROM PUBLIC;
REVOKE ALL ON platform_identity.role_catalog FROM authenticated;
REVOKE ALL ON platform_identity.role_catalog FROM goliath_web_anon;

CREATE OR REPLACE FUNCTION goliath_api.mvp_navigation(p_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE
  c jsonb;
  v_role text;
  v_surfaces jsonb := '[]'::jsonb;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  v_role:=c->>'role';
  SELECT rc.surfaces_json::jsonb INTO v_surfaces
  FROM platform_identity.role_catalog rc
  WHERE rc.role_key=v_role AND rc.active=1;
  v_surfaces:=COALESCE(v_surfaces,'[]'::jsonb);
  RETURN jsonb_build_object(
    'assignmentId',c->>'assignmentId',
    'role',v_role,
    'scopeType',c->>'scopeType',
    'scopeId',c->>'scopeId',
    'teamId',c->>'teamId',
    'surfaces',v_surfaces,
    'defaultSurface',CASE WHEN jsonb_array_length(v_surfaces)>0 THEN v_surfaces->>0 ELSE NULL END
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.mvp_navigation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.mvp_navigation(text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.mvp_navigation(text) TO authenticated;

CREATE OR REPLACE FUNCTION goliath_api.admin_role_coverage(p_acting_assignment_id text,p_project_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE
  c jsonb;
  v_project record;
  v_roles jsonb;
BEGIN
  c:=goliath_api.require_context(p_acting_assignment_id);
  IF c->>'role'<>'enterprise-admin' THEN
    RAISE EXCEPTION 'Enterprise Admin authority is required.' USING ERRCODE='42501';
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT p.id,p.name,p.organisation_id INTO v_project
    FROM public.pc_projects p WHERE p.id=p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown project.' USING ERRCODE='22023';
    END IF;
    IF c->>'scopeType'='organisation' AND v_project.organisation_id<>(c->>'scopeId') THEN
      RAISE EXCEPTION 'Project is outside the administrator organisation.' USING ERRCODE='42501';
    END IF;
  END IF;

  WITH role_rows AS (
    SELECT
      rc.role_key,
      rc.display_name,
      rc.default_scope_type,
      rc.purpose,
      rc.requires_team,
      rc.surfaces_json::jsonb AS surfaces,
      rc.sort_order,
      COUNT(a.id)::int AS active_assignment_count,
      COUNT(a.id) FILTER (WHERE EXISTS(
        SELECT 1 FROM platform_identity.user_links ul WHERE ul.user_id=a.user_id AND ul.active=1
      ))::int AS linked_identity_count,
      COUNT(a.id) FILTER (WHERE p_project_id IS NOT NULL AND CASE a.scope_type
        WHEN 'project' THEN a.scope_id=p_project_id
        WHEN 'program' THEN EXISTS(SELECT 1 FROM public.ec_project_context x WHERE x.project_id=p_project_id AND x.program_id=a.scope_id)
        WHEN 'portfolio' THEN EXISTS(SELECT 1 FROM public.ec_project_context x WHERE x.project_id=p_project_id AND x.portfolio_id=a.scope_id)
        WHEN 'organisation' THEN EXISTS(SELECT 1 FROM public.pc_projects p WHERE p.id=p_project_id AND p.organisation_id=a.scope_id)
        WHEN 'org-unit' THEN EXISTS(SELECT 1 FROM public.pc_projects p WHERE p.id=p_project_id AND p.organisation_id=(SELECT organisation_id FROM public.ec_org_units u WHERE u.id=a.scope_id))
        ELSE false END)::int AS project_coverage_count,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id',a.id,'userId',a.user_id,'displayName',a.display_name,'scopeType',a.scope_type,'scopeId',a.scope_id,
        'teamId',a.team_id,'identityLinked',EXISTS(SELECT 1 FROM platform_identity.user_links ul WHERE ul.user_id=a.user_id AND ul.active=1)
      ) ORDER BY a.display_name,a.id) FILTER (WHERE a.id IS NOT NULL),'[]'::jsonb) AS assignments
    FROM platform_identity.role_catalog rc
    LEFT JOIN public.ec_responsibility_assignments a ON a.role=rc.role_key AND a.active=1
      AND (c->>'scopeType'<>'organisation' OR CASE a.scope_type
        WHEN 'organisation' THEN a.scope_id=(c->>'scopeId')
        WHEN 'portfolio' THEN EXISTS(SELECT 1 FROM public.ec_portfolios pf WHERE pf.id=a.scope_id AND pf.organisation_id=(c->>'scopeId'))
        WHEN 'program' THEN EXISTS(SELECT 1 FROM public.ec_programs pg JOIN public.ec_portfolios pf ON pf.id=pg.portfolio_id WHERE pg.id=a.scope_id AND pf.organisation_id=(c->>'scopeId'))
        WHEN 'project' THEN EXISTS(SELECT 1 FROM public.pc_projects p WHERE p.id=a.scope_id AND p.organisation_id=(c->>'scopeId'))
        WHEN 'org-unit' THEN EXISTS(SELECT 1 FROM public.ec_org_units u WHERE u.id=a.scope_id AND u.organisation_id=(c->>'scopeId'))
        ELSE false END)
    WHERE rc.active=1
    GROUP BY rc.role_key,rc.display_name,rc.default_scope_type,rc.purpose,rc.requires_team,rc.surfaces_json,rc.sort_order
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'role',role_key,
    'displayName',display_name,
    'defaultScopeType',default_scope_type,
    'purpose',purpose,
    'requiresTeam',requires_team=1,
    'surfaces',surfaces,
    'activeAssignments',active_assignment_count,
    'linkedIdentities',linked_identity_count,
    'projectCoverage',project_coverage_count,
    'assignments',assignments,
    'status',CASE
      WHEN active_assignment_count=0 THEN 'unassigned'
      WHEN p_project_id IS NOT NULL AND project_coverage_count=0 AND role_key NOT IN ('enterprise-admin') THEN 'not-covering-project'
      WHEN linked_identity_count=0 THEN 'assigned-unlinked'
      ELSE 'ready'
    END
  ) ORDER BY sort_order),'[]'::jsonb) INTO v_roles
  FROM role_rows;

  RETURN jsonb_build_object(
    'project',CASE WHEN p_project_id IS NULL THEN NULL ELSE jsonb_build_object('id',v_project.id,'name',v_project.name) END,
    'roles',v_roles,
    'selectorPrinciple','The signed-in responsibility selector lists only responsibilities assigned to that authenticated identity. It is not an acting-as control.'
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.admin_role_coverage(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.admin_role_coverage(text,text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.admin_role_coverage(text,text) TO authenticated;

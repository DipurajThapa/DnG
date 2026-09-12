-- Goliath capacity ledger and planned-cost foundation
-- Date: 2026-09-12
-- Purpose: MVP capacity conflicts and planned cost only. No fabricated actuals, margin or EAC.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rc_capacity_policies (
  organisation_id text PRIMARY KEY REFERENCES public.ec_organisations(id) ON DELETE CASCADE,
  planning_ceiling real NOT NULL DEFAULT 0.80 CHECK (planning_ceiling>0 AND planning_ceiling<=1),
  concurrent_project_limit integer NOT NULL DEFAULT 2 CHECK (concurrent_project_limit>=1),
  calendar_mode text NOT NULL DEFAULT 'source-required' CHECK (calendar_mode IN ('source-required','mon-fri-development')),
  policy_version integer NOT NULL DEFAULT 1,
  updated_at text NOT NULL DEFAULT now()::text
);

ALTER TABLE public.rc_allocations
  ADD COLUMN IF NOT EXISTS planning_state text;
UPDATE public.rc_allocations
SET planning_state=CASE status WHEN 'confirmed' THEN 'hard' WHEN 'released' THEN 'released' ELSE 'soft' END
WHERE planning_state IS NULL;
ALTER TABLE public.rc_allocations ALTER COLUMN planning_state SET DEFAULT 'soft';
ALTER TABLE public.rc_allocations ALTER COLUMN planning_state SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rc_allocations_planning_state_check' AND conrelid='public.rc_allocations'::regclass) THEN
    ALTER TABLE public.rc_allocations ADD CONSTRAINT rc_allocations_planning_state_check CHECK (planning_state IN ('tentative','soft','hard','released'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.fin_rate_cards (
  id text PRIMARY KEY DEFAULT ('ratecard-'||gen_random_uuid()::text),
  organisation_id text NOT NULL REFERENCES public.ec_organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  currency text NOT NULL,
  source_system text NOT NULL,
  source_ref text NOT NULL,
  source_version text NOT NULL,
  effective_from text NOT NULL,
  effective_to text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','inactive')),
  classification text NOT NULL DEFAULT 'financial-cost' CHECK (classification='financial-cost'),
  created_at text NOT NULL DEFAULT now()::text,
  UNIQUE(organisation_id,source_system,source_ref,source_version)
);

CREATE TABLE IF NOT EXISTS public.fin_rate_card_lines (
  id text PRIMARY KEY DEFAULT ('rate-'||gen_random_uuid()::text),
  rate_card_id text NOT NULL REFERENCES public.fin_rate_cards(id) ON DELETE CASCADE,
  selector_type text NOT NULL CHECK (selector_type IN ('resource','org-unit')),
  selector_value text NOT NULL,
  hourly_cost real NOT NULL CHECK (hourly_cost>=0),
  effective_from text NOT NULL,
  effective_to text,
  source_ref text NOT NULL,
  UNIQUE(rate_card_id,selector_type,selector_value,effective_from)
);

CREATE INDEX IF NOT EXISTS idx_fin_rate_lines_selector
  ON public.fin_rate_card_lines(selector_type,selector_value,effective_from,effective_to);

CREATE OR REPLACE FUNCTION goliath_api.resource_capacity_desk(
  p_assignment_id text,
  p_period_start text,
  p_period_end text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE
  ctx jsonb;
  pol public.rc_capacity_policies%ROWTYPE;
  v_org text;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF ctx->>'role'<>'resource-manager' THEN
    RAISE EXCEPTION 'Resource Manager responsibility required.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'hr','read') THEN
    RAISE EXCEPTION 'HR data-class authority required for detailed capacity.' USING ERRCODE='42501';
  END IF;
  SELECT organisation_id INTO v_org FROM public.ec_org_units WHERE id=ctx->>'scopeId';
  IF v_org IS NULL THEN RAISE EXCEPTION 'Resource Manager scope is not a governed organisation unit.' USING ERRCODE='22023'; END IF;
  SELECT * INTO pol FROM public.rc_capacity_policies WHERE organisation_id=v_org;
  IF NOT FOUND THEN
    pol.planning_ceiling:=0.80; pol.concurrent_project_limit:=2; pol.calendar_mode:='source-required'; pol.policy_version:=1;
  END IF;
  RETURN jsonb_build_object(
    'period',jsonb_build_object('start',p_period_start,'end',p_period_end),
    'policy',jsonb_build_object('planningCeiling',pol.planning_ceiling,'concurrentProjectLimit',pol.concurrent_project_limit,'calendarMode',pol.calendar_mode,'version',pol.policy_version),
    'resources',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'resourceId',r.id,'displayName',r.display_name,'orgUnitId',r.org_unit_id,
      'grossHours',cp.gross_hours,'unavailableHours',cp.unavailable_hours,
      'netAvailableHours',CASE WHEN cp.id IS NULL THEN NULL ELSE cp.gross_hours-cp.unavailable_hours END,
      'hardHours',COALESCE(a.hard_hours,0),'softHours',COALESCE(a.soft_hours,0),'tentativeHours',COALESCE(a.tentative_hours,0),
      'projectCount',COALESCE(a.project_count,0),
      'capacityState',CASE
        WHEN cp.id IS NULL THEN 'data-insufficient'
        WHEN COALESCE(a.hard_hours,0)>cp.gross_hours-cp.unavailable_hours THEN 'hard-conflict'
        WHEN COALESCE(a.hard_hours,0)+COALESCE(a.soft_hours,0)>(cp.gross_hours-cp.unavailable_hours)*pol.planning_ceiling THEN 'ceiling-warning'
        WHEN COALESCE(a.project_count,0)>pol.concurrent_project_limit THEN 'concurrency-warning'
        ELSE 'available' END
    ) ORDER BY r.display_name)
    FROM public.rc_resources r
    LEFT JOIN public.rc_capacity_periods cp ON cp.resource_id=r.id AND cp.period_start=p_period_start AND cp.period_end=p_period_end
    LEFT JOIN LATERAL (
      SELECT
        sum(x.hours) FILTER (WHERE x.planning_state='hard') hard_hours,
        sum(x.hours) FILTER (WHERE x.planning_state='soft') soft_hours,
        sum(x.hours) FILTER (WHERE x.planning_state='tentative') tentative_hours,
        count(DISTINCT x.project_id) FILTER (WHERE x.planning_state IN ('hard','soft')) project_count
      FROM public.rc_allocations x
      WHERE x.resource_id=r.id AND x.planning_state<>'released'
        AND x.period_start<=p_period_end AND x.period_end>=p_period_start
    ) a ON true
    WHERE r.organisation_id=v_org AND r.org_unit_id=ctx->>'scopeId' AND r.active=1),'[]'::jsonb)
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.project_capacity_projection(
  p_assignment_id text,
  p_project_id text,
  p_period_start text,
  p_period_end text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb; v_can_hr boolean;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'delivery','read') THEN
    RAISE EXCEPTION 'Delivery read authority required.' USING ERRCODE='42501';
  END IF;
  v_can_hr:=goliath_api.context_has_data_class(p_assignment_id,'hr','read');
  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'period',jsonb_build_object('start',p_period_start,'end',p_period_end),
    'summary',jsonb_build_object(
      'hardHours',COALESCE((SELECT sum(hours) FROM public.rc_allocations WHERE project_id=p_project_id AND planning_state='hard' AND period_start<=p_period_end AND period_end>=p_period_start),0),
      'softHours',COALESCE((SELECT sum(hours) FROM public.rc_allocations WHERE project_id=p_project_id AND planning_state='soft' AND period_start<=p_period_end AND period_end>=p_period_start),0),
      'tentativeHours',COALESCE((SELECT sum(hours) FROM public.rc_allocations WHERE project_id=p_project_id AND planning_state='tentative' AND period_start<=p_period_end AND period_end>=p_period_start),0),
      'openDemandHours',COALESCE((SELECT sum(required_hours) FROM public.rc_demands WHERE project_id=p_project_id AND state IN ('open','partially-filled') AND period_start<=p_period_end AND period_end>=p_period_start),0)
    ),
    'resourceDetailVisible',v_can_hr,
    'resources',CASE WHEN v_can_hr THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('resourceId',r.id,'displayName',r.display_name,'hours',a.hours,'planningState',a.planning_state) ORDER BY r.display_name) FROM public.rc_allocations a JOIN public.rc_resources r ON r.id=a.resource_id WHERE a.project_id=p_project_id AND a.planning_state<>'released' AND a.period_start<=p_period_end AND a.period_end>=p_period_start),'[]'::jsonb) ELSE '[]'::jsonb END,
    'note',CASE WHEN v_can_hr THEN NULL ELSE 'Resource identity/availability detail is withheld because this responsibility does not hold the HR data class.' END
  );
END
$$;

CREATE OR REPLACE FUNCTION goliath_api.planned_cost_projection(
  p_assignment_id text,
  p_project_id text,
  p_period_start text,
  p_period_end text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $$
DECLARE ctx jsonb;
BEGIN
  ctx:=goliath_api.require_context(p_assignment_id);
  IF NOT goliath_api.context_allows_project(p_assignment_id,p_project_id) THEN
    RAISE EXCEPTION 'Project is outside this responsibility context.' USING ERRCODE='42501';
  END IF;
  IF NOT goliath_api.context_has_data_class(p_assignment_id,'financial-cost','read') THEN
    RAISE EXCEPTION 'Financial-cost data-class authority required.' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'projectId',p_project_id,
    'period',jsonb_build_object('start',p_period_start,'end',p_period_end),
    'basis','planned-cost-only',
    'actualCostAvailable',false,
    'marginAvailable',false,
    'eacAvailable',false,
    'currencies',COALESCE((
      WITH alloc AS (
        SELECT a.*,r.organisation_id,r.org_unit_id
        FROM public.rc_allocations a JOIN public.rc_resources r ON r.id=a.resource_id
        WHERE a.project_id=p_project_id AND a.planning_state IN ('soft','hard')
          AND a.period_start<=p_period_end AND a.period_end>=p_period_start
      ), rated AS (
        SELECT a.*,
          COALESCE(res.hourly_cost,unit.hourly_cost) hourly_cost,
          COALESCE(res.currency,unit.currency) currency
        FROM alloc a
        LEFT JOIN LATERAL (
          SELECT l.hourly_cost,rc.currency FROM public.fin_rate_card_lines l JOIN public.fin_rate_cards rc ON rc.id=l.rate_card_id
          WHERE rc.organisation_id=a.organisation_id AND rc.status='active' AND l.selector_type='resource' AND l.selector_value=a.resource_id
            AND l.effective_from<=a.period_end AND (l.effective_to IS NULL OR l.effective_to>=a.period_start)
          ORDER BY l.effective_from DESC LIMIT 1
        ) res ON true
        LEFT JOIN LATERAL (
          SELECT l.hourly_cost,rc.currency FROM public.fin_rate_card_lines l JOIN public.fin_rate_cards rc ON rc.id=l.rate_card_id
          WHERE rc.organisation_id=a.organisation_id AND rc.status='active' AND l.selector_type='org-unit' AND l.selector_value=a.org_unit_id
            AND l.effective_from<=a.period_end AND (l.effective_to IS NULL OR l.effective_to>=a.period_start)
          ORDER BY l.effective_from DESC LIMIT 1
        ) unit ON res.hourly_cost IS NULL
      )
      SELECT jsonb_agg(jsonb_build_object('currency',currency,'plannedCost',planned_cost,'ratedHours',rated_hours) ORDER BY currency)
      FROM (SELECT currency,sum(hours*hourly_cost) planned_cost,sum(hours) rated_hours FROM rated WHERE hourly_cost IS NOT NULL GROUP BY currency) q
    ),'[]'::jsonb),
    'missingRateAllocations',COALESCE((
      WITH alloc AS (
        SELECT a.*,r.organisation_id,r.org_unit_id FROM public.rc_allocations a JOIN public.rc_resources r ON r.id=a.resource_id
        WHERE a.project_id=p_project_id AND a.planning_state IN ('soft','hard') AND a.period_start<=p_period_end AND a.period_end>=p_period_start
      )
      SELECT count(*) FROM alloc a WHERE NOT EXISTS(
        SELECT 1 FROM public.fin_rate_card_lines l JOIN public.fin_rate_cards rc ON rc.id=l.rate_card_id
        WHERE rc.organisation_id=a.organisation_id AND rc.status='active'
          AND ((l.selector_type='resource' AND l.selector_value=a.resource_id) OR (l.selector_type='org-unit' AND l.selector_value=a.org_unit_id))
          AND l.effective_from<=a.period_end AND (l.effective_to IS NULL OR l.effective_to>=a.period_start)
      )
    ),0),
    'dataState',CASE
      WHEN NOT EXISTS(SELECT 1 FROM public.rc_allocations WHERE project_id=p_project_id AND planning_state IN ('soft','hard') AND period_start<=p_period_end AND period_end>=p_period_start) THEN 'data-insufficient'
      WHEN NOT EXISTS(SELECT 1 FROM public.fin_rate_cards rc JOIN public.pc_projects p ON p.organisation_id=rc.organisation_id WHERE p.id=p_project_id AND rc.status='active') THEN 'data-insufficient'
      ELSE 'available' END
  );
END
$$;

REVOKE ALL ON FUNCTION goliath_api.resource_capacity_desk(text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.project_capacity_projection(text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.planned_cost_projection(text,text,text,text) FROM PUBLIC,anonymous,goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.resource_capacity_desk(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.project_capacity_projection(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION goliath_api.planned_cost_projection(text,text,text,text) TO authenticated;

COMMIT;

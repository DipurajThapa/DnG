-- Development-only brownfield commitment candidate seed
-- Source: controlled Goliath/EDAPOS development plan v12.
-- Important: milestone rows become PROPOSALS only. Nothing is auto-confirmed as a commitment.

INSERT INTO public.pc_workstreams(
  id,project_id,name,methodology,source_system,active,created_at,updated_at
)
SELECT
  'ws-'||lower(id),
  id,
  'Default delivery stream',
  'unspecified',
  'migration',
  1,
  now()::text,
  now()::text
FROM public.pc_projects
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pc_commitment_candidates(
  project_id,source_type,source_ref,proposed_type,proposed_title,
  proposed_owner_id,proposed_date,proposed_acceptance_criteria,
  confidence,status,created_at,metadata_json
)
SELECT
  a.project_id,
  'controlled-plan',
  a.id,
  'milestone',
  a.title,
  a.owner_id,
  COALESCE(a.forecast_finish,a.baseline_finish),
  'Acceptance criteria require human confirmation before this candidate becomes an active commitment.',
  'high',
  'proposed',
  now()::text,
  jsonb_build_object(
    'activityId',a.id,
    'phase',a.phase,
    'sourceSystem',a.source_system,
    'sourceRef',a.source_ref,
    'source','EDAPOS_Detailed_Project_Plan_v12_2026-09-05.xlsx',
    'migrationRule','Milestones become commitment candidates, never auto-confirmed'
  )::text
FROM public.pc_activities a
WHERE a.project_id='GOLIATH-DEV'
  AND a.milestone=1
ON CONFLICT (project_id,source_type,source_ref) DO NOTHING;

-- Preserve baseline approval history while enforcing at most one pending request per project.
BEGIN;
ALTER TABLE public.pc_baseline_approval_requests DROP CONSTRAINT IF EXISTS pc_baseline_approval_requests_project_id_state_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pc_pending_baseline_approval
  ON public.pc_baseline_approval_requests(project_id)
  WHERE state='pending';
COMMIT;

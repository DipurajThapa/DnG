-- Baseline snapshot immutability hardening
-- Approved/history baseline snapshots must never be edited or deleted in place.

BEGIN;

DROP TRIGGER IF EXISTS trg_pc_baselines_no_update ON public.pc_baselines;
DROP TRIGGER IF EXISTS trg_pc_baselines_no_delete ON public.pc_baselines;

CREATE TRIGGER trg_pc_baselines_no_update
BEFORE UPDATE ON public.pc_baselines
FOR EACH ROW EXECUTE FUNCTION public.edapos_reject_mutation_on_append_only();

CREATE TRIGGER trg_pc_baselines_no_delete
BEFORE DELETE ON public.pc_baselines
FOR EACH ROW EXECUTE FUNCTION public.edapos_reject_mutation_on_append_only();

COMMIT;

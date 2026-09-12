-- Add explicit data-class access mode to each action instead of inferring it from the action name.
ALTER TABLE platform_identity.action_catalog ADD COLUMN IF NOT EXISTS data_action text NOT NULL DEFAULT 'write';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='action_catalog_data_action_check' AND conrelid='platform_identity.action_catalog'::regclass) THEN
    ALTER TABLE platform_identity.action_catalog ADD CONSTRAINT action_catalog_data_action_check CHECK (data_action IN ('read','write'));
  END IF;
END $$;

UPDATE platform_identity.action_catalog SET data_action='read'
WHERE (object_type,action) IN (
('project','read'),('commitment','read'),('decision','read'),('dependency','read'),('requirement','read'),('raid','read'),
('baseline','read'),('report','read'),('capacity','read'),('integration','read-health'),
('identity','invite'),('responsibility','grant'),('responsibility','revoke'));

UPDATE platform_identity.action_catalog SET data_action='write'
WHERE (object_type,action) NOT IN (
('project','read'),('commitment','read'),('decision','read'),('dependency','read'),('requirement','read'),('raid','read'),
('baseline','read'),('report','read'),('capacity','read'),('integration','read-health'),
('identity','invite'),('responsibility','grant'),('responsibility','revoke'));

CREATE OR REPLACE FUNCTION goliath_api.capability_mode(p_assignment_id text,p_object_type text,p_action text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE c jsonb; p record; v_class_ok boolean;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  SELECT rap.authority_mode,ac.data_class,ac.data_action INTO p
  FROM platform_identity.role_action_policy rap
  JOIN platform_identity.action_catalog ac ON ac.object_type=rap.object_type AND ac.action=rap.action
  WHERE rap.role_key=c->>'role' AND rap.object_type=p_object_type AND rap.action=p_action AND rap.active=1 AND ac.active=1;
  IF NOT FOUND OR p.authority_mode='deny' THEN RETURN 'deny'; END IF;
  v_class_ok:=goliath_api.context_has_data_class(p_assignment_id,p.data_class,p.data_action);
  IF NOT v_class_ok THEN RETURN 'deny'; END IF;
  RETURN p.authority_mode;
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.capability_mode(text,text,text) FROM PUBLIC, authenticated, goliath_web_anon;

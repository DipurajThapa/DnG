-- Correct read/write data-class evaluation for the role-action capability catalog.
CREATE OR REPLACE FUNCTION goliath_api.capability_mode(p_assignment_id text,p_object_type text,p_action text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE c jsonb; p record; v_class_ok boolean; v_data_action text;
BEGIN
  c:=goliath_api.require_context(p_assignment_id);
  SELECT rap.authority_mode,ac.data_class,ac.action INTO p
  FROM platform_identity.role_action_policy rap
  JOIN platform_identity.action_catalog ac ON ac.object_type=rap.object_type AND ac.action=rap.action
  WHERE rap.role_key=c->>'role' AND rap.object_type=p_object_type AND rap.action=p_action AND rap.active=1 AND ac.active=1;
  IF NOT FOUND THEN RETURN 'deny'; END IF;
  IF p.authority_mode='deny' THEN RETURN 'deny'; END IF;
  v_data_action:=CASE WHEN p.action='read' OR p.action LIKE 'read-%' THEN 'read' ELSE 'write' END;
  v_class_ok:=goliath_api.context_has_data_class(p_assignment_id,p.data_class,v_data_action);
  IF NOT v_class_ok THEN RETURN 'deny'; END IF;
  RETURN p.authority_mode;
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.capability_mode(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.capability_mode(text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION goliath_api.capability_mode(text,text,text) FROM goliath_web_anon;

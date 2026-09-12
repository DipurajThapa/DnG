-- Goliath legacy public RPC lockdown
-- Date: 2026-09-12
-- The old acceptance bridge exposed context/workspace and helper functions anonymously.
-- Named-user Goliath no longer permits those direct paths.

BEGIN;

-- Obsolete anonymous acceptance APIs: retain implementation for migration history,
-- but make them unavailable to browser/application roles.
REVOKE ALL ON FUNCTION goliath_api.list_contexts() FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.workspace(text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;

-- Audit-chain appenders are internal implementation details. Direct browser execution
-- would allow fabricated audit records even if underlying tables are protected.
REVOKE ALL ON FUNCTION goliath_api.append_context_event(text,text,text,text,text,text,text,jsonb) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.append_project_event(text,text,text,text,text,text,text,integer,integer,jsonb,jsonb) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;

-- Authorization / computation helpers remain callable by their owning SECURITY DEFINER
-- workflows but are not standalone client APIs.
REVOKE ALL ON FUNCTION goliath_api.require_context(text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.context_allows_project(text,text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.add_working_days(date,integer) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;
REVOKE ALL ON FUNCTION goliath_api.data_class_rank(text) FROM PUBLIC,authenticated,anonymous,goliath_web_anon;

COMMIT;

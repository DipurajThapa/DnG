-- Invitation flow v2: idempotent invitation creation, scoped targets, and share auditing.
-- Both email and manual-copy sharing use the same invitation record/token.

CREATE OR REPLACE FUNCTION goliath_api.admin_invitation_targets(p_acting_assignment_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','platform_identity','auth','goliath_api'
AS $function$
DECLARE
  c jsonb;
  v_org text;
BEGIN
  c:=goliath_api.require_context(p_acting_assignment_id);
  IF c->>'role'<>'enterprise-admin' OR c->>'scopeType'<>'organisation' THEN
    RAISE EXCEPTION 'Enterprise Admin organisation authority is required.' USING ERRCODE='42501';
  END IF;
  v_org:=c->>'scopeId';

  RETURN jsonb_build_object(
    'targets',COALESCE((
      WITH scoped AS (
        SELECT a.*
        FROM public.ec_responsibility_assignments a
        WHERE a.active=1 AND CASE a.scope_type
          WHEN 'organisation' THEN a.scope_id=v_org
          WHEN 'portfolio' THEN EXISTS(SELECT 1 FROM public.ec_portfolios p WHERE p.id=a.scope_id AND p.organisation_id=v_org)
          WHEN 'program' THEN EXISTS(SELECT 1 FROM public.ec_programs g JOIN public.ec_portfolios p ON p.id=g.portfolio_id WHERE g.id=a.scope_id AND p.organisation_id=v_org)
          WHEN 'project' THEN EXISTS(SELECT 1 FROM public.pc_projects p WHERE p.id=a.scope_id AND p.organisation_id=v_org)
          WHEN 'org-unit' THEN EXISTS(SELECT 1 FROM public.ec_org_units u WHERE u.id=a.scope_id AND u.organisation_id=v_org)
          ELSE false END
      ), grouped AS (
        SELECT user_id,max(display_name) AS display_name,
          jsonb_agg(jsonb_build_object('id',id,'role',role,'scopeType',scope_type,'scopeId',scope_id,'teamId',team_id) ORDER BY role,scope_type,scope_id) AS assignments
        FROM scoped GROUP BY user_id
      )
      SELECT jsonb_agg(jsonb_build_object(
        'userId',g.user_id,
        'displayName',g.display_name,
        'identityLinked',EXISTS(SELECT 1 FROM platform_identity.user_links ul WHERE ul.user_id=g.user_id AND ul.active=1),
        'linkedEmail',(SELECT ul.email FROM platform_identity.user_links ul WHERE ul.user_id=g.user_id AND ul.active=1 ORDER BY ul.linked_at DESC LIMIT 1),
        'assignments',g.assignments,
        'pendingInvitation',(SELECT jsonb_build_object('email',i.email,'expiresAt',i.expires_at) FROM platform_identity.invitations i WHERE i.user_id=g.user_id AND i.status='pending' AND i.expires_at>now() ORDER BY i.issued_at DESC LIMIT 1)
      ) ORDER BY g.display_name)
      FROM grouped g
    ),'[]'::jsonb)
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.admin_invitation_targets(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.admin_invitation_targets(text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.admin_invitation_targets(text) TO authenticated;

CREATE OR REPLACE FUNCTION goliath_api.admin_create_identity_invitation(
  p_acting_assignment_id text,
  p_email text,
  p_user_id text,
  p_expires_hours integer DEFAULT 168
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'platform_identity','neon_auth','auth','public','goliath_api'
AS $function$
DECLARE
  c jsonb;
  v_org text;
  v_email text;
  v_token uuid;
  v_expires timestamptz;
  v_reused boolean:=false;
  v_target_in_scope boolean:=false;
BEGIN
  c:=goliath_api.require_context(p_acting_assignment_id);
  IF c->>'role'<>'enterprise-admin' OR c->>'scopeType'<>'organisation' THEN
    RAISE EXCEPTION 'Enterprise Admin organisation authority is required.' USING ERRCODE='42501';
  END IF;
  v_org:=c->>'scopeId';
  v_email:=lower(trim(p_email));

  IF v_email IS NULL OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid target email is required.' USING ERRCODE='22023';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.ec_responsibility_assignments a
    WHERE a.user_id=p_user_id AND a.active=1 AND CASE a.scope_type
      WHEN 'organisation' THEN a.scope_id=v_org
      WHEN 'portfolio' THEN EXISTS(SELECT 1 FROM public.ec_portfolios p WHERE p.id=a.scope_id AND p.organisation_id=v_org)
      WHEN 'program' THEN EXISTS(SELECT 1 FROM public.ec_programs g JOIN public.ec_portfolios p ON p.id=g.portfolio_id WHERE g.id=a.scope_id AND p.organisation_id=v_org)
      WHEN 'project' THEN EXISTS(SELECT 1 FROM public.pc_projects p WHERE p.id=a.scope_id AND p.organisation_id=v_org)
      WHEN 'org-unit' THEN EXISTS(SELECT 1 FROM public.ec_org_units u WHERE u.id=a.scope_id AND u.organisation_id=v_org)
      ELSE false END
  ) INTO v_target_in_scope;
  IF NOT v_target_in_scope THEN
    RAISE EXCEPTION 'Target user is outside this administrator organisation scope.' USING ERRCODE='42501';
  END IF;

  IF EXISTS(SELECT 1 FROM platform_identity.user_links WHERE user_id=p_user_id AND active=1) THEN
    RAISE EXCEPTION 'This Goliath user already has a linked identity.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM platform_identity.user_links WHERE lower(email)=v_email AND active=1 AND user_id<>p_user_id) THEN
    RAISE EXCEPTION 'This email is already linked to another Goliath user.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM platform_identity.invitations WHERE lower(email)=v_email AND status='pending' AND expires_at>now() AND user_id<>p_user_id) THEN
    RAISE EXCEPTION 'This email already has a pending invitation for another Goliath user.' USING ERRCODE='22023';
  END IF;

  SELECT token,expires_at INTO v_token,v_expires
  FROM platform_identity.invitations
  WHERE lower(email)=v_email AND user_id=p_user_id AND status='pending' AND expires_at>now()
  ORDER BY issued_at DESC LIMIT 1;

  IF FOUND THEN
    v_reused:=true;
  ELSE
    UPDATE platform_identity.invitations
      SET status='revoked',revoked_at=now()
      WHERE user_id=p_user_id AND status='pending';
    INSERT INTO platform_identity.invitations(email,user_id,issued_by_subject,expires_at)
      VALUES(v_email,p_user_id,auth.user_id(),now()+make_interval(hours=>greatest(1,least(coalesce(p_expires_hours,168),720))))
      RETURNING token,expires_at INTO v_token,v_expires;
    INSERT INTO platform_identity.audit_events(actor_subject,event_type,user_id,details)
      VALUES(auth.user_id(),'identity.invitation.created',p_user_id,jsonb_build_object('email',v_email,'actingAssignmentId',p_acting_assignment_id));
  END IF;

  RETURN jsonb_build_object(
    'token',v_token,
    'email',v_email,
    'userId',p_user_id,
    'expiresAt',v_expires,
    'reused',v_reused
  );
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.admin_create_identity_invitation(text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.admin_create_identity_invitation(text,text,text,integer) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.admin_create_identity_invitation(text,text,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION goliath_api.admin_record_identity_invitation_share(
  p_acting_assignment_id text,
  p_token uuid,
  p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'platform_identity','auth','public','goliath_api'
AS $function$
DECLARE
  c jsonb;
  v_inv record;
BEGIN
  c:=goliath_api.require_context(p_acting_assignment_id);
  IF c->>'role'<>'enterprise-admin' THEN
    RAISE EXCEPTION 'Enterprise Admin authority is required.' USING ERRCODE='42501';
  END IF;
  IF p_channel NOT IN ('copy-token','email-client') THEN
    RAISE EXCEPTION 'Unsupported invitation sharing channel.' USING ERRCODE='22023';
  END IF;
  SELECT token,email,user_id,status,expires_at INTO v_inv FROM platform_identity.invitations WHERE token=p_token;
  IF NOT FOUND OR v_inv.status<>'pending' OR v_inv.expires_at<=now() THEN
    RAISE EXCEPTION 'Invitation is not pending and shareable.' USING ERRCODE='22023';
  END IF;
  INSERT INTO platform_identity.audit_events(actor_subject,event_type,user_id,details)
    VALUES(auth.user_id(),'identity.invitation.shared',v_inv.user_id,jsonb_build_object('email',v_inv.email,'channel',p_channel,'actingAssignmentId',p_acting_assignment_id));
  RETURN jsonb_build_object('recorded',true,'channel',p_channel);
END
$function$;

REVOKE ALL ON FUNCTION goliath_api.admin_record_identity_invitation_share(text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION goliath_api.admin_record_identity_invitation_share(text,uuid,text) FROM goliath_web_anon;
GRANT EXECUTE ON FUNCTION goliath_api.admin_record_identity_invitation_share(text,uuid,text) TO authenticated;

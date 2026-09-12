-- DEVELOPMENT-ONLY acceptance persona coverage for GOLIATH-DEV.
-- This file is intentionally outside migrations/ and must not be treated as a production data migration.
-- It creates responsibility contexts for existing synthetic development personas without linking them to Auth identities.

INSERT INTO public.pc_project_members(project_id,user_id,display_name,role,team_id,active,permissions_json,joined_at)
VALUES ('GOLIATH-DEV','agile','Agile Lead','delivery-lead','gdev-product',1,'[]',now()::text)
ON CONFLICT (project_id,user_id) DO NOTHING;

INSERT INTO public.ec_responsibility_assignments
(id,user_id,display_name,role,scope_type,scope_id,team_id,active,permissions_json,effective_from,effective_to,granted_by,granted_at,revision)
VALUES
('GDEV-DL-AISHA','gdev-aisha-rahman','Aisha Rahman','delivery-lead','project','GOLIATH-DEV','gdev-product',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-ELENA','gdev-elena-garcia','Elena Garcia','delivery-lead','project','GOLIATH-DEV','gdev-devops-sre',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-FATIMA','gdev-fatima-zahra','Fatima Zahra','delivery-lead','project','GOLIATH-DEV','gdev-quality-engineering',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-LIAM','gdev-liam-walker','Liam Walker','delivery-lead','project','GOLIATH-DEV','gdev-integrations',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-MEERA','gdev-meera-iyer','Meera Iyer','delivery-lead','project','GOLIATH-DEV','gdev-architecture',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-NOAH','gdev-noah-kim','Noah Kim','delivery-lead','project','GOLIATH-DEV','gdev-frontend-ux',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-OMAR','gdev-omar-haddad','Omar Haddad','delivery-lead','project','GOLIATH-DEV','gdev-platform-engineering',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-PRIYA','gdev-priya-nair','Priya Nair','delivery-lead','project','GOLIATH-DEV','gdev-backend-engineering',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-RAVI','gdev-ravi-menon','Ravi Menon','delivery-lead','project','GOLIATH-DEV','gdev-security',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-DL-SARA','gdev-sara-al-mansoori','Sara Al-Mansoori','delivery-lead','project','GOLIATH-DEV','gdev-ai-data',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-AGILE','agile','Agile Lead','agile-delivery-lead','project','GOLIATH-DEV','gdev-product',1,'[]',now()::text,NULL,'development-seed',now()::text,1),
('GDEV-TM-KHALID','gdev-khalid-farooq','Khalid Farooq','team-member','project','GOLIATH-DEV','gdev-pilot-operations',1,'[]',now()::text,NULL,'development-seed',now()::text,1)
ON CONFLICT (id) DO NOTHING;

-- Project Admin was introduced after the original 11-role coverage seed. Add a
-- complete unlinked development fixture without deriving delivery visibility.
INSERT INTO platform_identity.organisation_memberships(
  id,organisation_id,user_id,display_name,contact_email,status,created_by
)
VALUES ('GDEV-PA-OM','ORG1','gdev-project-admin','Goliath Project Admin',NULL,'active','development-seed')
ON CONFLICT (organisation_id,user_id) DO UPDATE SET
  display_name=EXCLUDED.display_name,status='active',ended_at=NULL,updated_at=now(),
  revision=platform_identity.organisation_memberships.revision+1;

INSERT INTO public.pc_project_members(project_id,user_id,display_name,role,team_id,active,permissions_json,joined_at)
VALUES ('GOLIATH-DEV','gdev-project-admin','Goliath Project Admin','project-admin',NULL,1,'[]',now()::text)
ON CONFLICT (project_id,user_id) DO UPDATE SET
  display_name=EXCLUDED.display_name,role='project-admin',team_id=NULL,active=1,permissions_json='[]';

INSERT INTO public.pc_project_memberships(
  id,project_id,organisation_membership_id,status,admission_source,joined_at,ended_at,assigned_by
)
VALUES ('GDEV-PA-PMEM','GOLIATH-DEV','GDEV-PA-OM','active','direct',now(),NULL,'development-seed')
ON CONFLICT (project_id,organisation_membership_id) DO UPDATE SET
  status='active',admission_source='direct',ended_at=NULL,assigned_by='development-seed',
  revision=public.pc_project_memberships.revision+1;

INSERT INTO public.ec_responsibility_assignments(
  id,user_id,display_name,role,scope_type,scope_id,team_id,active,permissions_json,
  effective_from,effective_to,granted_by,granted_at,revision
)
VALUES (
  'GDEV-PA','gdev-project-admin','Goliath Project Admin','project-admin','project','GOLIATH-DEV',NULL,1,'[]',
  now()::text,NULL,'development-seed',now()::text,1
)
ON CONFLICT (id) DO UPDATE SET
  display_name=EXCLUDED.display_name,role='project-admin',scope_type='project',scope_id='GOLIATH-DEV',
  team_id=NULL,active=1,permissions_json='[]',effective_to=NULL,revoked_by=NULL,revoked_at=NULL,
  revocation_reason=NULL,revision=public.ec_responsibility_assignments.revision+1;

INSERT INTO public.ec_responsibility_sources(
  id,responsibility_id,source_type,source_id,active,granted_by,granted_at
)
VALUES ('GDEV-PA-SOURCE','GDEV-PA','direct','GDEV-PA-PMEM',1,'development-seed',now())
ON CONFLICT (id) DO UPDATE SET
  active=1,revoked_by=NULL,revoked_at=NULL,revocation_reason=NULL,
  revision=public.ec_responsibility_sources.revision+1;

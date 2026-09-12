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

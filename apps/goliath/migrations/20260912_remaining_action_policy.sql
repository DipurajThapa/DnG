-- Extend canonical role/action policy to remaining material authenticated write paths.

INSERT INTO platform_identity.action_catalog(object_type,action,display_name,data_class,consequence,data_action) VALUES
('requirement','baseline','Baseline requirement','delivery','consequential','write'),
('requirement','link','Link requirement','delivery','normal','write'),
('requirement','confirm-link','Confirm/reject requirement link','delivery','normal','write'),
('requirement','accept','Accept requirement','delivery','consequential','write'),
('change','create','Raise change request','delivery','normal','write'),
('change','prepare','Classify and prepare change impact','delivery','consequential','write'),
('change','finalize','Apply approved change/rebaseline','delivery','consequential','write'),
('handoff','create','Create delivery handoff','delivery','normal','write'),
('handoff','respond','Accept/return delivery handoff','delivery','normal','write'),
('work','update','Update execution evidence/work','delivery','normal','write'),
('work','assign','Assign/reassign execution work','delivery','normal','write'),
('commitment','set-evidence-spec','Set commitment evidence specification','delivery','consequential','write'),
('workstream','set-methodology','Set workstream methodology','delivery','consequential','write'),
('health','pm-assessment','Record PM assessment','delivery','normal','write'),
('health','record-snapshot','Record deterministic health snapshot','delivery','normal','write'),
('raid','update','Update owned/governed RAID item','delivery','normal','write'),
('raid','evaluate-triggers','Evaluate deterministic RAID triggers','delivery','normal','write'),
('raid','convert-trigger','Convert trigger candidate to issue','delivery','consequential','write'),
('decision','delegate','Delegate owned decision','delivery','consequential','write'),
('notification','refresh','Refresh responsibility notifications','delivery','normal','write'),
('notification','respond','Respond to own notification','delivery','normal','read'),
('access','data-class-override','Set explicit data-class authority','audit','administrative','read')
ON CONFLICT (object_type,action) DO UPDATE SET display_name=EXCLUDED.display_name,data_class=EXCLUDED.data_class,consequence=EXCLUDED.consequence,data_action=EXCLUDED.data_action,active=1;

INSERT INTO platform_identity.role_action_policy(role_key,object_type,action,authority_mode,notes)
SELECT r.role_key,a.object_type,a.action,'deny','Default deny; explicitly overridden below.'
FROM platform_identity.role_catalog r CROSS JOIN platform_identity.action_catalog a
WHERE r.active=1 AND a.active=1
ON CONFLICT (role_key,object_type,action) DO NOTHING;

-- Requirement lifecycle stays with management/control roles.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Governed requirement lifecycle authority.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo') AND (object_type,action) IN (
('requirement','baseline'),('requirement','link'),('requirement','confirm-link'),('requirement','accept'));

-- Any governed delivery participant may raise a change request; classification/rebaseline remains management authority.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='May raise a change candidate/request; does not grant approval or baseline authority.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo','delivery-lead','agile-delivery-lead','team-member','sponsor') AND object_type='change' AND action='create';
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Management may classify and assemble change impact.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo') AND object_type='change' AND action='prepare';
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Management may apply an already approved change; approval remains a named Decision.'
WHERE role_key IN ('project-manager','project-director','pmo') AND object_type='change' AND action='finalize';

-- Execution work / handoff authority: management can act across scope; team roles only when named owner/receiver/team condition is met.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Project management may manage delivery handoffs in scope.'
WHERE role_key IN ('project-manager','project-director') AND (object_type,action) IN (('handoff','create'),('handoff','respond'),('work','update'),('work','assign'));
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='source-owner',notes='May create handoff only for work they own.'
WHERE role_key IN ('delivery-lead','agile-delivery-lead','team-member') AND object_type='handoff' AND action='create';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-receiver',notes='May accept/return only handoffs addressed to them.'
WHERE role_key IN ('delivery-lead','agile-delivery-lead','team-member') AND object_type='handoff' AND action='respond';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='governed-team',notes='May update work only inside their governed team.'
WHERE role_key IN ('delivery-lead','agile-delivery-lead') AND object_type='work' AND action='update';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='owned-work',notes='May update only work they own.'
WHERE role_key='team-member' AND object_type='work' AND action='update';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='governed-team',notes='Delivery Lead may assign/reassign within governed team.'
WHERE role_key='delivery-lead' AND object_type='work' AND action='assign';

-- Commitment readiness / methodology stay with project controls, not program/sponsor/team execution.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Project-control readiness authority.'
WHERE role_key IN ('project-manager','project-director','pmo') AND (object_type,action) IN (('commitment','set-evidence-spec'),('workstream','set-methodology'),('health','record-snapshot'));
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='PM judgement is recorded beside computed health, never overwriting it.'
WHERE role_key='project-manager' AND object_type='health' AND action='pm-assessment';

-- RAID updates: management may update in scope; item owners may update their own record. Trigger evaluation/conversion is management-controlled.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Management RAID maintenance within governed scope.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo') AND object_type='raid' AND action='update';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='raid-owner',notes='May update only a RAID item they own.'
WHERE role_key IN ('delivery-lead','agile-delivery-lead','team-member','sponsor') AND object_type='raid' AND action='update';
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Management may evaluate deterministic trigger conditions.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo') AND object_type='raid' AND action='evaluate-triggers';
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Named human management authority converts trigger candidate into issue.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo') AND object_type='raid' AND action='convert-trigger';

-- Decision delegation is always conditional on being the current named decision owner.
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='named-decision-owner',notes='Only current named decision owner may delegate.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo','delivery-lead','agile-delivery-lead','team-member','sponsor') AND object_type='decision' AND action='delegate';

-- Notification generation is management-controlled; response is always scoped to the notification recipient/data class.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Management may refresh responsibility-driven control queue.'
WHERE role_key IN ('project-manager','project-director','program-manager','pmo') AND object_type='notification' AND action='refresh';
UPDATE platform_identity.role_action_policy SET authority_mode='conditional',condition_code='notification-recipient',notes='May respond only to a notification available to this identity/data class.'
WHERE role_key IN ('portfolio-manager','program-manager','project-director','project-manager','pmo','resource-manager','delivery-lead','agile-delivery-lead','team-member','sponsor') AND object_type='notification' AND action='respond';

-- Access-policy override remains Enterprise Admin only.
UPDATE platform_identity.role_action_policy SET authority_mode='allow',condition_code=NULL,notes='Organisation Enterprise Admin may record explicit data-class override with reason/audit.'
WHERE role_key='enterprise-admin' AND object_type='access' AND action='data-class-override';

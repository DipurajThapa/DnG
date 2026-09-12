import type { ProjectPermission, ProjectMember } from './types.js';
import type { UserRole } from '../ux/navigation.js';

const defaults: Readonly<Record<UserRole, readonly ProjectPermission[]>> = {
  'team-member': [
    'project:view-summary', 'activity:view-own', 'activity:update-own', 'attention:view-own', 'handoff:respond', 'decision:view',
  ],
  'delivery-lead': [
    'project:view-full', 'activity:view-team', 'activity:update-team', 'activity:assign-team', 'people:view-team',
    'attention:view-team', 'decision:view', 'decision:prepare', 'handoff:respond', 'report:view',
  ],
  'project-manager': [
    'project:view-full', 'project:transition', 'plan:edit', 'activity:view-all', 'activity:update-all', 'activity:assign-all',
    'people:view-all', 'money:view', 'attention:view-all', 'decision:view', 'decision:prepare', 'handoff:respond', 'report:view',
  ],
  'program-manager': [
    'portfolio:view', 'project:view-full', 'activity:view-all', 'activity:assign-all', 'people:view-all', 'money:view',
    'attention:view-all', 'decision:view', 'decision:prepare', 'report:view',
  ],
  sponsor: [
    'project:view-summary', 'activity:view-all', 'money:view-summary', 'attention:view-own', 'decision:view', 'decision:approve', 'report:view',
  ],
  pmo: [
    'portfolio:view', 'project:view-full', 'activity:view-all', 'people:view-all', 'money:view', 'attention:view-all',
    'decision:view', 'report:view', 'admin:policy',
  ],
  'enterprise-admin': ['admin:integrations', 'admin:policy'],
};

export function defaultPermissions(role: UserRole): readonly ProjectPermission[] { return defaults[role]; }

export function effectivePermissions(member: ProjectMember): readonly ProjectPermission[] {
  return [...new Set([...defaultPermissions(member.role), ...member.permissions])];
}

export function hasPermission(member: ProjectMember, permission: ProjectPermission): boolean {
  return effectivePermissions(member).includes(permission);
}

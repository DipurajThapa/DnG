export type UserRole = 'team-member' | 'delivery-lead' | 'project-manager' | 'program-manager' | 'sponsor' | 'pmo' | 'enterprise-admin';
export type GlobalDestination = 'Attention' | 'Projects' | 'My Work' | 'Administration';
export type ProjectDestination = 'Overview' | 'Plan' | 'People' | 'Money' | 'Delivery';

const globalByRole: Readonly<Record<UserRole, readonly GlobalDestination[]>> = {
  'team-member': ['Attention', 'My Work'],
  'delivery-lead': ['Attention', 'Projects', 'My Work'],
  'project-manager': ['Attention', 'Projects', 'My Work'],
  'program-manager': ['Attention', 'Projects'],
  sponsor: ['Attention', 'Projects'],
  pmo: ['Attention', 'Projects', 'Administration'],
  'enterprise-admin': ['Administration'],
};

export function globalNavigation(role: UserRole): readonly GlobalDestination[] { return globalByRole[role]; }
export function projectNavigation(role: UserRole): readonly ProjectDestination[] {
  if (role === 'enterprise-admin') return [];
  if (role === 'team-member') return ['Overview', 'Plan', 'Delivery'];
  if (role === 'delivery-lead') return ['Overview', 'Plan', 'People', 'Delivery'];
  return ['Overview', 'Plan', 'People', 'Money', 'Delivery'];
}

export function defaultLanding(role: UserRole): GlobalDestination {
  return role === 'enterprise-admin' ? 'Administration' : 'Attention';
}

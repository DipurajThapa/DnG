import type { ResponsibilityRole } from '../context/types.js';

export interface RoleExperienceProfile {
  role: ResponsibilityRole;
  purpose: string;
  defaultLanding: string;
  globalNavigation: readonly string[];
  projectSections: readonly string[];
  defaultHorizonDays: number;
  defaultDetail: 'executive' | 'portfolio' | 'program' | 'full-project' | 'control-quality' | 'functional-capacity' | 'team' | 'personal' | 'administration';
}

/** Declarative experience metadata. It changes presentation/query shape, never business truth. */
export const ROLE_EXPERIENCE_PROFILES: Readonly<Record<ResponsibilityRole, RoleExperienceProfile>> = {
  sponsor: { role:'sponsor', purpose:'Make consequential project decisions and understand business impact.', defaultLanding:'Decisions', globalNavigation:['Attention','Projects'], projectSections:['Overview','Money','Risks & Decisions','Delivery'], defaultHorizonDays:90, defaultDetail:'executive' },
  'portfolio-manager': { role:'portfolio-manager', purpose:'Optimise investments, capacity and interventions across the portfolio.', defaultLanding:'Portfolio', globalNavigation:['Portfolio','Attention','Scenarios'], projectSections:[], defaultHorizonDays:180, defaultDetail:'portfolio' },
  'program-manager': { role:'program-manager', purpose:'Coordinate outcomes, dependencies and shared constraints across related projects.', defaultLanding:'Program', globalNavigation:['Program','Projects','Attention','Reports'], projectSections:['Overview','Plan','People','Money','Risks & Decisions','Delivery'], defaultHorizonDays:120, defaultDetail:'program' },
  'project-director': { role:'project-director', purpose:'Own major delivery, customer and commercial outcomes where this layer exists.', defaultLanding:'Delivery', globalNavigation:['Attention','Projects','Reports'], projectSections:['Overview','Plan','Work','People','Money','Risks & Decisions','Delivery','Reports'], defaultHorizonDays:120, defaultDetail:'full-project' },
  'project-manager': { role:'project-manager', purpose:'Manage complete project delivery while working primarily by exception and action.', defaultLanding:'Attention', globalNavigation:['Attention','Projects'], projectSections:['Overview','Plan','Work','People','Money','Risks & Decisions','Delivery','Reports'], defaultHorizonDays:60, defaultDetail:'full-project' },
  pmo: { role:'pmo', purpose:'Govern control quality, consistency, traceability and exceptions without becoming the status-collection team.', defaultLanding:'Controls', globalNavigation:['Controls','Projects','Reports','Administration'], projectSections:['Overview','Plan','People','Risks & Decisions','Delivery','Audit'], defaultHorizonDays:90, defaultDetail:'control-quality' },
  'resource-manager': { role:'resource-manager', purpose:'Manage functional capacity, allocation, demand and staffing conflicts.', defaultLanding:'Capacity', globalNavigation:['Capacity'], projectSections:[], defaultHorizonDays:90, defaultDetail:'functional-capacity' },
  'delivery-lead': { role:'delivery-lead', purpose:'Coordinate delivery of one team or workstream.', defaultLanding:'Team', globalNavigation:['Team','Attention'], projectSections:['Overview','Work','People','Delivery'], defaultHorizonDays:30, defaultDetail:'team' },
  'agile-delivery-lead': { role:'agile-delivery-lead', purpose:'Improve delivery flow, predictability and impediment resolution.', defaultLanding:'Flow', globalNavigation:['Flow','Work','Blockers'], projectSections:['Overview','Work','Dependencies','Delivery'], defaultHorizonDays:21, defaultDetail:'team' },
  'team-member': { role:'team-member', purpose:'Execute assigned work and respond only where judgement or action is required.', defaultLanding:'My Work', globalNavigation:['My Work','Attention'], projectSections:['Overview','Work','Delivery'], defaultHorizonDays:14, defaultDetail:'personal' },
  'enterprise-admin': { role:'enterprise-admin', purpose:'Operate identity, source and policy controls without unnecessary project-content access.', defaultLanding:'Administration', globalNavigation:['Administration'], projectSections:[], defaultHorizonDays:30, defaultDetail:'administration' },
};

export function roleExperienceProfile(role: ResponsibilityRole): RoleExperienceProfile { return ROLE_EXPERIENCE_PROFILES[role]; }

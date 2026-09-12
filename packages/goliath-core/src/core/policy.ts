import { GoliathError } from './errors.js';
import type { ActorContext, IntegrationBinding } from './types.js';

export function requireProject(actor: ActorContext, organisationId: string, projectId: string): void {
  if (actor.organisationId !== organisationId || !actor.projectIds.includes(projectId)) {
    throw new GoliathError('ACCESS_DENIED', 'Actor is outside the organisation/project scope.');
  }
}

export function requirePermission(actor: ActorContext, permission: string): void {
  if (!actor.permissions.includes(permission)) {
    throw new GoliathError('ACCESS_DENIED', `Missing permission: ${permission}`);
  }
}

export function requireBindingEnabled(binding: IntegrationBinding): void {
  if (!binding.enabled) throw new GoliathError('INTEGRATION_DISABLED', 'Integration binding is disabled.');
}

export function requireInboundFields(binding: IntegrationBinding, fields: readonly string[]): void {
  const disallowed = fields.filter((field) => !binding.allowedInboundFields.includes(field));
  if (disallowed.length > 0) {
    throw new GoliathError('FIELD_AUTHORITY_DENIED', `Inbound fields are not authorised: ${disallowed.join(', ')}`);
  }
}

export function requireOutboundAction(binding: IntegrationBinding, action: string): void {
  if (!binding.allowedOutboundActions.includes(action)) {
    throw new GoliathError('ACTION_NOT_ALLOWED', `Outbound action is not authorised: ${action}`);
  }
}

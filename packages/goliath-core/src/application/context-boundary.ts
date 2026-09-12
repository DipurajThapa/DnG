import { GoliathError } from '../core/errors.js';
import { EnterpriseContextService } from '../context/service.js';
import type { ActingContext, ResponsibilityPermission } from '../context/types.js';

export interface ApplicationContextRequest {
  userId: string;
  actingAssignmentId: string;
}

/**
 * Single application/API authorization boundary.
 * New application services resolve the selected acting context here before reading or mutating domain data.
 */
export class ActingContextBoundary {
  constructor(public readonly contexts: EnterpriseContextService) {}

  resolve(request: ApplicationContextRequest): ActingContext {
    if (!request.userId.trim() || !request.actingAssignmentId.trim()) {
      throw new GoliathError('ACCESS_DENIED', 'A user and acting responsibility context are required.');
    }
    return this.contexts.resolveActingContext(request.userId, request.actingAssignmentId);
  }

  requireProject(
    request: ApplicationContextRequest,
    projectId: string,
    permission: ResponsibilityPermission,
  ): ActingContext {
    return this.contexts.authorizeProject(request.userId, request.actingAssignmentId, projectId, permission);
  }

  requireProjectAny(
    request: ApplicationContextRequest,
    projectId: string,
    permissions: readonly ResponsibilityPermission[],
  ): ActingContext {
    const context = this.resolve(request);
    if (!context.accessibleProjectIds.includes(projectId)) {
      return this.contexts.authorizeProject(request.userId, request.actingAssignmentId, projectId, permissions[0] ?? 'project:view-summary');
    }
    if (!permissions.some((permission) => context.permissions.includes(permission))) {
      return this.contexts.authorizeProject(request.userId, request.actingAssignmentId, projectId, permissions[0] ?? 'project:view-summary');
    }
    return context;
  }

  requireFunctionalUnit(
    request: ApplicationContextRequest,
    orgUnitId: string,
    permission: ResponsibilityPermission,
  ): ActingContext {
    const context = this.resolve(request);
    if (!context.functionalOrgUnitIds.includes(orgUnitId)) {
      throw new GoliathError('ACCESS_DENIED', 'Organisational unit is outside the selected responsibility context.');
    }
    if (!context.permissions.includes(permission)) {
      throw new GoliathError('ACCESS_DENIED', 'Action is not permitted in the selected responsibility context.');
    }
    return context;
  }
}

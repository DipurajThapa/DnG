import { GoliathError } from '../core/errors.js';

export type IdentityLifecycleEventType = 'joiner' | 'mover' | 'leaver' | 'reactivate';

export interface EnterpriseIdentity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  organisationId: string;
  active: boolean;
  membershipVersion: number;
  projectGrants: Readonly<Record<string, readonly string[]>>;
}

export interface IdentityLifecycleEvent {
  id: string;
  type: IdentityLifecycleEventType;
  issuer: string;
  subject: string;
  organisationId: string;
  occurredAt: string;
  nextEmail?: string;
  nextEmailVerified?: boolean;
  nextProjectGrants?: Readonly<Record<string, readonly string[]>>;
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function eventTime(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new GoliathError('INVALID_INPUT', 'Identity lifecycle occurredAt must be a valid ISO date/time.');
  return parsed;
}

export class EnterpriseIdentityRegistry {
  private readonly identities = new Map<string, EnterpriseIdentity>();
  private readonly sessions = new Map<string, { subjectKey: string; active: boolean }>();
  private readonly processedEvents = new Set<string>();
  private readonly lastEventAt = new Map<string, number>();

  private key(issuer: string, subject: string): string { return `${issuer}|${subject}`; }

  private revokeSessions(subjectKey: string): void {
    for (const session of this.sessions.values()) if (session.subjectKey === subjectKey) session.active = false;
  }

  upsert(identity: EnterpriseIdentity): void {
    if (!validEmail(identity.email)) throw new GoliathError('INVALID_INPUT', 'Enterprise identity email is invalid.');
    this.identities.set(this.key(identity.issuer, identity.subject), { ...identity });
  }

  get(issuer: string, subject: string): EnterpriseIdentity | undefined {
    return this.identities.get(this.key(issuer, subject));
  }

  issueSession(sessionId: string, issuer: string, subject: string): void {
    const key = this.key(issuer, subject);
    const identity = this.identities.get(key);
    if (!identity?.active || !identity.emailVerified) throw new GoliathError('ACCESS_DENIED', 'Inactive or unverified identity cannot receive a session.');
    this.sessions.set(sessionId, { subjectKey: key, active: true });
  }

  apply(event: IdentityLifecycleEvent): EnterpriseIdentity {
    const key = this.key(event.issuer, event.subject);
    const current = this.identities.get(key);

    if (this.processedEvents.has(event.id)) {
      if (!current) throw new GoliathError('NOT_FOUND', 'Previously processed identity event has no retained identity.');
      return current;
    }

    const occurredAt = eventTime(event.occurredAt);
    const lastAt = this.lastEventAt.get(key);
    if (lastAt !== undefined && occurredAt < lastAt) {
      throw new GoliathError('STALE_REVISION', 'Out-of-order identity lifecycle event rejected.');
    }

    let next: EnterpriseIdentity;
    if (event.type === 'joiner') {
      if (!current) {
        if (!event.nextEmail || !validEmail(event.nextEmail)) throw new GoliathError('INVALID_INPUT', 'Joiner requires a valid email.');
        next = {
          issuer: event.issuer,
          subject: event.subject,
          email: event.nextEmail,
          emailVerified: event.nextEmailVerified ?? false,
          organisationId: event.organisationId,
          active: true,
          membershipVersion: 1,
          projectGrants: event.nextProjectGrants ?? {},
        };
      } else {
        if (current.organisationId !== event.organisationId) throw new GoliathError('ACCESS_DENIED', 'Cross-organisation identity event rejected.');
        const email = event.nextEmail ?? current.email;
        if (!validEmail(email)) throw new GoliathError('INVALID_INPUT', 'Joiner email is invalid.');
        const emailChanged = email.toLowerCase() !== current.email.toLowerCase();
        next = {
          ...current,
          email,
          emailVerified: emailChanged ? (event.nextEmailVerified ?? false) : (event.nextEmailVerified ?? current.emailVerified),
          active: true,
          projectGrants: event.nextProjectGrants ?? current.projectGrants,
          membershipVersion: current.membershipVersion + 1,
        };
        if (emailChanged) this.revokeSessions(key);
      }
    } else {
      if (!current) throw new GoliathError('NOT_FOUND', 'Identity not found.');
      if (current.organisationId !== event.organisationId) throw new GoliathError('ACCESS_DENIED', 'Cross-organisation identity event rejected.');

      if (event.type === 'leaver') {
        next = { ...current, active: false, projectGrants: {}, membershipVersion: current.membershipVersion + 1 };
        this.revokeSessions(key);
      } else if (event.type === 'mover') {
        const email = event.nextEmail ?? current.email;
        if (!validEmail(email)) throw new GoliathError('INVALID_INPUT', 'Mover email is invalid.');
        const emailChanged = email.toLowerCase() !== current.email.toLowerCase();
        next = {
          ...current,
          email,
          emailVerified: emailChanged ? (event.nextEmailVerified ?? false) : (event.nextEmailVerified ?? current.emailVerified),
          ...(event.nextProjectGrants ? { projectGrants: event.nextProjectGrants } : {}),
          membershipVersion: current.membershipVersion + 1,
        };
        if (emailChanged) this.revokeSessions(key);
      } else {
        next = { ...current, active: true, membershipVersion: current.membershipVersion + 1 };
      }
    }

    this.identities.set(key, next);
    this.processedEvents.add(event.id);
    this.lastEventAt.set(key, occurredAt);
    return next;
  }

  canAccess(sessionId: string, organisationId: string, projectId: string, permission: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.active) return false;
    const identity = this.identities.get(session.subjectKey);
    if (!identity?.active || !identity.emailVerified || identity.organisationId !== organisationId) return false;
    return identity.projectGrants[projectId]?.includes(permission) ?? false;
  }
}

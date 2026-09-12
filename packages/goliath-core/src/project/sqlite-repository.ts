import type { SyncSqlDatabase } from '../persistence/sync-database.js';
import { digest } from '../core/hash.js';
import { GoliathError } from '../core/errors.js';
import type { AttentionItem, AiAssessment, AutonomousCycleResult } from '../control/types.js';
import type { ControlRepository } from '../control/repository.js';
import type {
  ActivityRecord,
  AssignmentRecord,
  DecisionRecord,
  DependencyRecord,
  HandoffRecord,
  ProjectEventRecord,
  ProjectMember,
  ProjectRecord,
  SourceStateRecord,
  StoredProjectionRecord,
  WorkActionRecord,
} from './types.js';

function parseArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function bool(value: unknown): boolean { return Number(value) === 1; }
function optional<T>(value: T | null | undefined): T | undefined { return value === null || value === undefined ? undefined : value; }

function eventHashPayload(event: Omit<ProjectEventRecord, 'eventHash' | 'previousHash'>, previousHash: string | undefined): Record<string, unknown> {
  return {
    id: event.id,
    projectId: event.projectId,
    actorId: event.actorId,
    eventType: event.eventType,
    entityType: event.entityType,
    entityId: event.entityId,
    result: event.result,
    reason: event.reason,
    occurredAt: event.occurredAt,
    correlationId: event.correlationId,
    causationId: event.causationId ?? null,
    beforeRevision: event.beforeRevision ?? null,
    afterRevision: event.afterRevision ?? null,
    sourceRefs: [...event.sourceRefs],
    metadata: event.metadata ?? {},
    previousHash: previousHash ?? null,
  };
}

export class SqlProjectRepository implements ControlRepository {
  constructor(public readonly db: SyncSqlDatabase) {}

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getProject(id: string): ProjectRecord | undefined {
    const row = this.db.prepare('SELECT * FROM pc_projects WHERE id = ?').get(id);
    return row ? this.mapProject(row) : undefined;
  }

  listProjects(organisationId: string): readonly ProjectRecord[] {
    return this.db.prepare('SELECT * FROM pc_projects WHERE organisation_id = ? ORDER BY name').all(organisationId).map((r) => this.mapProject(r));
  }

  insertProject(project: ProjectRecord): void {
    this.db.prepare(`INSERT INTO pc_projects (
      id, organisation_id, code, name, lifecycle, pm_id, sponsor_id, timezone, baseline_version,
      baseline_accepted, material_outcomes_confirmed, first_work_ready, required_team_leads_assigned,
      legitimate_evidence_source_available, baseline_finish, forecast_finish, budget, eac, currency,
      evidence_confidence, source_health_summary, created_at, updated_at, revision
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      project.id, project.organisationId, project.code, project.name, project.lifecycle, project.pmId, project.sponsorId ?? null,
      project.timezone, project.baselineVersion ?? null, project.baselineAccepted ? 1 : 0, project.materialOutcomesConfirmed ? 1 : 0,
      project.firstWorkReady ? 1 : 0, project.requiredTeamLeadsAssigned ? 1 : 0, project.legitimateEvidenceSourceAvailable ? 1 : 0,
      project.baselineFinish ?? null, project.forecastFinish ?? null, project.budget ?? null, project.eac ?? null, project.currency ?? null,
      project.evidenceConfidence, project.sourceHealthSummary, project.createdAt, project.updatedAt, project.revision,
    );
  }

  updateProject(project: ProjectRecord): void {
    const result = this.db.prepare(`UPDATE pc_projects SET
      name=?, lifecycle=?, pm_id=?, sponsor_id=?, timezone=?, baseline_version=?, baseline_accepted=?,
      material_outcomes_confirmed=?, first_work_ready=?, required_team_leads_assigned=?, legitimate_evidence_source_available=?,
      baseline_finish=?, forecast_finish=?, budget=?, eac=?, currency=?, evidence_confidence=?, source_health_summary=?, updated_at=?, revision=?
      WHERE id=? AND revision=?`).run(
      project.name, project.lifecycle, project.pmId, project.sponsorId ?? null, project.timezone, project.baselineVersion ?? null,
      project.baselineAccepted ? 1 : 0, project.materialOutcomesConfirmed ? 1 : 0, project.firstWorkReady ? 1 : 0,
      project.requiredTeamLeadsAssigned ? 1 : 0, project.legitimateEvidenceSourceAvailable ? 1 : 0, project.baselineFinish ?? null,
      project.forecastFinish ?? null, project.budget ?? null, project.eac ?? null, project.currency ?? null, project.evidenceConfidence,
      project.sourceHealthSummary, project.updatedAt, project.revision, project.id, project.revision - 1,
    );
    if (Number(result.changes) !== 1) throw new GoliathError('STALE_REVISION', `Project ${project.id} changed concurrently.`);
  }

  upsertMember(member: ProjectMember): void {
    this.db.prepare(`INSERT INTO pc_project_members(project_id,user_id,display_name,role,team_id,active,permissions_json,joined_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,user_id) DO UPDATE SET display_name=excluded.display_name, role=excluded.role,
      team_id=excluded.team_id, active=excluded.active, permissions_json=excluded.permissions_json`).run(
      member.projectId, member.userId, member.displayName, member.role, member.teamId ?? null, member.active ? 1 : 0,
      JSON.stringify(member.permissions), member.joinedAt,
    );
  }

  getMember(projectId: string, userId: string): ProjectMember | undefined {
    const row = this.db.prepare('SELECT * FROM pc_project_members WHERE project_id=? AND user_id=?').get(projectId, userId);
    return row ? this.mapMember(row) : undefined;
  }

  listMembers(projectId: string): readonly ProjectMember[] {
    return this.db.prepare('SELECT * FROM pc_project_members WHERE project_id=? ORDER BY display_name').all(projectId).map((r) => this.mapMember(r));
  }

  insertActivity(activity: ActivityRecord): void {
    this.db.prepare(`INSERT INTO pc_activities(
      id,project_id,phase,title,description,status,baseline_start,baseline_finish,forecast_finish,actual_start,actual_finish,
      planned_team_id,current_team_id,owner_id,priority,percent_complete,milestone,source_system,source_ref,evidence_refs_json,blocker,revision
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      activity.id, activity.projectId, activity.phase, activity.title, activity.description ?? null, activity.status,
      activity.baselineStart ?? null, activity.baselineFinish ?? null, activity.forecastFinish ?? null, activity.actualStart ?? null,
      activity.actualFinish ?? null, activity.plannedTeamId ?? null, activity.currentTeamId ?? null, activity.ownerId ?? null,
      activity.priority, activity.percentComplete ?? null, activity.milestone ? 1 : 0, activity.sourceSystem ?? null, activity.sourceRef ?? null,
      JSON.stringify(activity.evidenceRefs), activity.blocker ?? null, activity.revision,
    );
  }

  getActivity(id: string): ActivityRecord | undefined {
    const row = this.db.prepare('SELECT * FROM pc_activities WHERE id=?').get(id);
    return row ? this.mapActivity(row) : undefined;
  }

  listActivities(projectId: string): readonly ActivityRecord[] {
    return this.db.prepare("SELECT * FROM pc_activities WHERE project_id=? ORDER BY COALESCE(baseline_start, '9999'), id").all(projectId).map((r) => this.mapActivity(r));
  }

  updateActivity(activity: ActivityRecord): void {
    const result = this.db.prepare(`UPDATE pc_activities SET
      phase=?,title=?,description=?,status=?,baseline_start=?,baseline_finish=?,forecast_finish=?,actual_start=?,actual_finish=?,
      planned_team_id=?,current_team_id=?,owner_id=?,priority=?,percent_complete=?,milestone=?,source_system=?,source_ref=?,
      evidence_refs_json=?,blocker=?,revision=? WHERE id=? AND revision=?`).run(
      activity.phase, activity.title, activity.description ?? null, activity.status, activity.baselineStart ?? null,
      activity.baselineFinish ?? null, activity.forecastFinish ?? null, activity.actualStart ?? null, activity.actualFinish ?? null,
      activity.plannedTeamId ?? null, activity.currentTeamId ?? null, activity.ownerId ?? null, activity.priority,
      activity.percentComplete ?? null, activity.milestone ? 1 : 0, activity.sourceSystem ?? null, activity.sourceRef ?? null,
      JSON.stringify(activity.evidenceRefs), activity.blocker ?? null, activity.revision, activity.id, activity.revision - 1,
    );
    if (Number(result.changes) !== 1) throw new GoliathError('STALE_REVISION', `Activity ${activity.id} changed concurrently.`);
  }

  insertDependency(dependency: DependencyRecord): void {
    this.db.prepare(`INSERT INTO pc_dependencies(id,project_id,predecessor_activity_id,successor_activity_id,gate_type,mandatory)
      VALUES(?,?,?,?,?,?)`).run(dependency.id, dependency.projectId, dependency.predecessorActivityId, dependency.successorActivityId, dependency.gateType, dependency.mandatory ? 1 : 0);
  }

  listDependencies(projectId: string): readonly DependencyRecord[] {
    return this.db.prepare('SELECT * FROM pc_dependencies WHERE project_id=? ORDER BY id').all(projectId).map((r) => ({
      id: String(r.id), projectId: String(r.project_id), predecessorActivityId: String(r.predecessor_activity_id),
      successorActivityId: String(r.successor_activity_id), gateType: r.gate_type as DependencyRecord['gateType'], mandatory: bool(r.mandatory),
    }));
  }

  insertAssignment(assignment: AssignmentRecord): void {
    this.db.prepare(`INSERT INTO pc_assignments(id,project_id,activity_id,assignee_id,team_id,support_owner_ids_json,assigned_by,effective_from,ended_at,reason,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      assignment.id, assignment.projectId, assignment.activityId, assignment.assigneeId, assignment.teamId ?? null,
      JSON.stringify(assignment.supportOwnerIds), assignment.assignedBy, assignment.effectiveFrom, assignment.endedAt ?? null,
      assignment.reason ?? null, assignment.revision,
    );
  }

  endActiveAssignment(activityId: string, endedAt: string): void {
    this.db.prepare('UPDATE pc_assignments SET ended_at=?, revision=revision+1 WHERE activity_id=? AND ended_at IS NULL').run(endedAt, activityId);
  }

  updateAssignment(assignment: AssignmentRecord): void {
    const result = this.db.prepare(`UPDATE pc_assignments SET assignee_id=?,team_id=?,support_owner_ids_json=?,ended_at=?,reason=?,revision=? WHERE id=? AND revision=?`).run(
      assignment.assigneeId, assignment.teamId ?? null, JSON.stringify(assignment.supportOwnerIds), assignment.endedAt ?? null, assignment.reason ?? null,
      assignment.revision, assignment.id, assignment.revision - 1,
    );
    if (Number(result.changes) !== 1) throw new GoliathError('STALE_REVISION', `Assignment ${assignment.id} changed concurrently.`);
  }

  getActiveAssignment(activityId: string): AssignmentRecord | undefined {
    const row = this.db.prepare('SELECT * FROM pc_assignments WHERE activity_id=? AND ended_at IS NULL').get(activityId);
    return row ? this.mapAssignment(row) : undefined;
  }

  listAssignments(projectId: string): readonly AssignmentRecord[] {
    return this.db.prepare('SELECT * FROM pc_assignments WHERE project_id=? ORDER BY effective_from,id').all(projectId).map((r) => this.mapAssignment(r));
  }

  upsertDecision(decision: DecisionRecord): void {
    this.db.prepare(`INSERT INTO pc_decisions(id,project_id,attention_item_id,decision_owner_id,decided_by,state,choice,reason,evidence_refs_json,created_at,decided_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,attention_item_id) DO UPDATE SET decision_owner_id=excluded.decision_owner_id, decided_by=excluded.decided_by,
      state=excluded.state,choice=excluded.choice,reason=excluded.reason,evidence_refs_json=excluded.evidence_refs_json,decided_at=excluded.decided_at,revision=excluded.revision`).run(
      decision.id, decision.projectId, decision.attentionItemId, decision.decisionOwnerId, decision.decidedBy ?? null, decision.state,
      decision.choice ?? null, decision.reason ?? null, JSON.stringify(decision.evidenceRefs), decision.createdAt, decision.decidedAt ?? null, decision.revision,
    );
  }

  getDecisionByAttention(projectId: string, attentionItemId: string): DecisionRecord | undefined {
    const row = this.db.prepare('SELECT * FROM pc_decisions WHERE project_id=? AND attention_item_id=?').get(projectId, attentionItemId);
    return row ? this.mapDecision(row) : undefined;
  }

  listDecisions(projectId: string): readonly DecisionRecord[] {
    return this.db.prepare('SELECT * FROM pc_decisions WHERE project_id=? ORDER BY created_at').all(projectId).map((r) => this.mapDecision(r));
  }

  insertHandoff(handoff: HandoffRecord): void {
    this.db.prepare(`INSERT INTO pc_handoffs(id,project_id,source_activity_id,target_activity_id,sender_id,receiver_id,deliverable_version,state,
      required_checks_passed,required_checks_total,blocking_conditions_json,non_blocking_conditions_json,attempt,returned_reason,accepted_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      handoff.id, handoff.projectId, handoff.sourceActivityId, handoff.targetActivityId, handoff.senderId, handoff.receiverId,
      handoff.deliverableVersion, handoff.state, handoff.requiredChecksPassed, handoff.requiredChecksTotal,
      JSON.stringify(handoff.blockingConditions), JSON.stringify(handoff.nonBlockingConditions), handoff.attempt, handoff.returnedReason ?? null,
      handoff.acceptedAt ?? null, handoff.revision,
    );
  }

  getHandoff(id: string): HandoffRecord | undefined {
    const row = this.db.prepare('SELECT * FROM pc_handoffs WHERE id=?').get(id);
    return row ? this.mapHandoff(row) : undefined;
  }

  updateHandoff(handoff: HandoffRecord): void {
    const result = this.db.prepare(`UPDATE pc_handoffs SET state=?,required_checks_passed=?,required_checks_total=?,blocking_conditions_json=?,
      non_blocking_conditions_json=?,attempt=?,returned_reason=?,accepted_at=?,revision=? WHERE id=? AND revision=?`).run(
      handoff.state, handoff.requiredChecksPassed, handoff.requiredChecksTotal, JSON.stringify(handoff.blockingConditions),
      JSON.stringify(handoff.nonBlockingConditions), handoff.attempt, handoff.returnedReason ?? null, handoff.acceptedAt ?? null,
      handoff.revision, handoff.id, handoff.revision - 1,
    );
    if (Number(result.changes) !== 1) throw new GoliathError('STALE_REVISION', `Handoff ${handoff.id} changed concurrently.`);
  }

  listHandoffs(projectId: string): readonly HandoffRecord[] {
    return this.db.prepare('SELECT * FROM pc_handoffs WHERE project_id=? ORDER BY id').all(projectId).map((r) => this.mapHandoff(r));
  }

  upsertSource(source: SourceStateRecord): void {
    this.db.prepare(`INSERT INTO pc_sources(id,project_id,source_type,source_ref,authority,status,last_observed_at,freshness_hours,classification,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,source_ref) DO UPDATE SET source_type=excluded.source_type,authority=excluded.authority,
      status=excluded.status,last_observed_at=excluded.last_observed_at,freshness_hours=excluded.freshness_hours,classification=excluded.classification,revision=excluded.revision`).run(
      source.id, source.projectId, source.sourceType, source.sourceRef, source.authority, source.status, source.lastObservedAt ?? null,
      source.freshnessHours, source.classification, source.revision,
    );
  }

  listSources(projectId: string): readonly SourceStateRecord[] {
    return this.db.prepare('SELECT * FROM pc_sources WHERE project_id=? ORDER BY source_type,source_ref').all(projectId).map((r) => ({
      id: String(r.id), projectId: String(r.project_id), sourceType: String(r.source_type), sourceRef: String(r.source_ref), authority: String(r.authority),
      status: r.status as SourceStateRecord['status'], ...(optional(r.last_observed_at) ? { lastObservedAt: String(r.last_observed_at) } : {}),
      freshnessHours: Number(r.freshness_hours), classification: r.classification as SourceStateRecord['classification'], revision: Number(r.revision),
    }));
  }

  insertWorkAction(action: WorkActionRecord): void {
    this.db.prepare(`INSERT INTO pc_work_actions(id,project_id,attention_item_id,activity_id,type,title,owner_id,due_at,state,created_by,created_at,completed_at,source_refs_json,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      action.id, action.projectId, action.attentionItemId ?? null, action.activityId ?? null, action.type, action.title, action.ownerId,
      action.dueAt ?? null, action.state, action.createdBy, action.createdAt, action.completedAt ?? null, JSON.stringify(action.sourceRefs), action.revision,
    );
  }

  listWorkActions(projectId: string): readonly WorkActionRecord[] {
    return this.db.prepare('SELECT * FROM pc_work_actions WHERE project_id=? ORDER BY created_at,id').all(projectId).map((r) => this.mapWorkAction(r));
  }

  findOpenWorkAction(projectId: string, attentionItemId: string, type: WorkActionRecord['type']): WorkActionRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM pc_work_actions WHERE project_id=? AND attention_item_id=? AND type=? AND state='open'`).get(projectId, attentionItemId, type);
    return row ? this.mapWorkAction(row) : undefined;
  }

  updateWorkAction(action: WorkActionRecord): void {
    const result = this.db.prepare(`UPDATE pc_work_actions SET title=?,owner_id=?,due_at=?,state=?,completed_at=?,source_refs_json=?,revision=? WHERE id=? AND revision=?`).run(
      action.title, action.ownerId, action.dueAt ?? null, action.state, action.completedAt ?? null, JSON.stringify(action.sourceRefs),
      action.revision, action.id, action.revision - 1,
    );
    if (Number(result.changes) !== 1) throw new GoliathError('STALE_REVISION', `Work action ${action.id} changed concurrently.`);
  }

  appendEvent(event: Omit<ProjectEventRecord, 'eventHash' | 'previousHash'>): ProjectEventRecord {
    const prior = this.db.prepare('SELECT event_hash FROM pc_project_events WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(event.projectId);
    const previousHash = prior ? String(prior.event_hash) : undefined;
    const eventHash = digest(eventHashPayload(event, previousHash));
    const full: ProjectEventRecord = { ...event, ...(previousHash ? { previousHash } : {}), eventHash };
    this.db.prepare(`INSERT INTO pc_project_events(id,project_id,actor_id,event_type,entity_type,entity_id,result,reason,occurred_at,correlation_id,
      causation_id,before_revision,after_revision,source_refs_json,metadata_json,previous_hash,event_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      full.id, full.projectId, full.actorId, full.eventType, full.entityType, full.entityId, full.result, full.reason, full.occurredAt,
      full.correlationId, full.causationId ?? null, full.beforeRevision ?? null, full.afterRevision ?? null, JSON.stringify(full.sourceRefs),
      JSON.stringify(full.metadata ?? {}), full.previousHash ?? null, full.eventHash,
    );
    return full;
  }

  getEvent(id: string): ProjectEventRecord | undefined {
    const row = this.db.prepare('SELECT * FROM pc_project_events WHERE id=?').get(id);
    return row ? this.mapEvent(row) : undefined;
  }

  listEvents(projectId: string): readonly ProjectEventRecord[] {
    return this.db.prepare('SELECT * FROM pc_project_events WHERE project_id=? ORDER BY rowid').all(projectId).map((r) => this.mapEvent(r));
  }

  verifyEventChain(projectId: string): boolean {
    let previousHash: string | undefined;
    for (const event of this.listEvents(projectId)) {
      if (event.previousHash !== previousHash) return false;
      const { eventHash: _hash, previousHash: _prev, ...base } = event;
      const expected = digest(eventHashPayload(base, previousHash));
      if (expected !== event.eventHash) return false;
      previousHash = event.eventHash;
    }
    return true;
  }

  insertProjection(snapshot: StoredProjectionRecord): void {
    this.db.prepare(`INSERT INTO pc_report_snapshots(id,project_id,audience,generated_at,headline,projection_hash,projection_json,source_refs_json)
      VALUES(?,?,?,?,?,?,?,?)`).run(snapshot.id, snapshot.projectId, snapshot.audience, snapshot.generatedAt, snapshot.headline, snapshot.projectionHash, snapshot.projectionJson, JSON.stringify(snapshot.sourceRefs));
  }

  listProjections(projectId: string): readonly StoredProjectionRecord[] {
    return this.db.prepare('SELECT * FROM pc_report_snapshots WHERE project_id=? ORDER BY generated_at,id').all(projectId).map((r) => ({
      id: String(r.id), projectId: String(r.project_id), audience: r.audience as StoredProjectionRecord['audience'], generatedAt: String(r.generated_at),
      headline: String(r.headline), projectionHash: String(r.projection_hash), projectionJson: String(r.projection_json), sourceRefs: parseArray(r.source_refs_json),
    }));
  }

  // ControlRepository implementation: persist attention/cycles/AI assessments in the existing AI-first tables.
  getAttentionByRoot(projectId: string, rootCauseKey: string): AttentionItem | undefined {
    const row = this.db.prepare('SELECT * FROM attention_items WHERE project_id=? AND root_cause_key=?').get(projectId, rootCauseKey);
    return row ? this.mapAttention(row) : undefined;
  }

  getAttention(id: string): AttentionItem | undefined {
    const row = this.db.prepare('SELECT * FROM attention_items WHERE id=?').get(id);
    return row ? this.mapAttention(row) : undefined;
  }

  putAttention(item: AttentionItem): void {
    this.db.prepare(`INSERT INTO attention_items(id,organisation_id,project_id,root_cause_key,title,state,consequence,confidence,situation,impact,
      owner_id,decision_owner_id,due_at,next_action,first_seen_at,last_seen_at,resolved_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,state=excluded.state,consequence=excluded.consequence,confidence=excluded.confidence,
      situation=excluded.situation,impact=excluded.impact,owner_id=excluded.owner_id,decision_owner_id=excluded.decision_owner_id,due_at=excluded.due_at,
      next_action=excluded.next_action,last_seen_at=excluded.last_seen_at,resolved_at=excluded.resolved_at,revision=excluded.revision`).run(
      item.id,item.organisationId,item.projectId,item.rootCauseKey,item.title,item.state,item.consequence,item.confidence,item.situation,item.impact,
      item.ownerId ?? null,item.decisionOwnerId ?? null,item.dueAt ?? null,item.nextAction,item.firstSeenAt,item.lastSeenAt,item.resolvedAt ?? null,item.revision,
    );
    this.db.prepare('DELETE FROM attention_sources WHERE attention_item_id=?').run(item.id);
    const sourceSignalIds = item.sourceSignalIds.length > 0 ? item.sourceSignalIds : ['unknown-signal'];
    const sourceRefs = item.sourceRefs.length > 0 ? item.sourceRefs : ['internal:derived'];
    for (const signalId of sourceSignalIds) for (const sourceRef of sourceRefs) {
      this.db.prepare('INSERT OR IGNORE INTO attention_sources(attention_item_id,source_ref,source_signal_id) VALUES(?,?,?)').run(item.id,sourceRef,signalId);
    }
  }

  listAttention(projectId: string): readonly AttentionItem[] {
    return this.db.prepare('SELECT * FROM attention_items WHERE project_id=? ORDER BY first_seen_at,id').all(projectId).map((r) => this.mapAttention(r));
  }

  putCycle(result: AutonomousCycleResult): void {
    this.db.prepare(`INSERT INTO autonomous_cycles(cycle_id,project_id,observed_signals,material_signals,attention_created,attention_updated,auto_resolved,ai_assessments,suppressed_no_material_change,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(result.cycleId,result.projectId,result.observedSignals,result.materialSignals,result.attentionCreated,result.attentionUpdated,result.autoResolved,result.aiAssessments,result.suppressedAsNoMaterialChange?1:0,result.completedAt);
  }

  listCycles(projectId: string): readonly AutonomousCycleResult[] {
    // Actions are persisted separately in pc_work_actions; historic cycle rows retain summary counts.
    return this.db.prepare('SELECT * FROM autonomous_cycles WHERE project_id=? ORDER BY completed_at').all(projectId).map((r) => ({
      cycleId:String(r.cycle_id), projectId:String(r.project_id), observedSignals:Number(r.observed_signals), materialSignals:Number(r.material_signals),
      attentionCreated:Number(r.attention_created), attentionUpdated:Number(r.attention_updated), autoResolved:Number(r.auto_resolved), preparedActions:[],
      aiAssessments:Number(r.ai_assessments), suppressedAsNoMaterialChange:bool(r.suppressed_no_material_change), completedAt:String(r.completed_at),
    }));
  }

  putAiAssessment(attentionItemId: string, assessment: AiAssessment): void {
    this.db.prepare(`INSERT INTO ai_assessments(assessment_id,attention_item_id,generated_at,model_label,summary,recommended_option_id,confidence,abstained,assessment_json)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(assessment_id) DO UPDATE SET assessment_json=excluded.assessment_json`).run(
      assessment.assessmentId,attentionItemId,assessment.generatedAt,assessment.modelLabel,assessment.summary,assessment.recommendedOptionId ?? null,
      assessment.confidence,assessment.abstained?1:0,JSON.stringify(assessment),
    );
  }

  getAiAssessment(attentionItemId: string): AiAssessment | undefined {
    const row = this.db.prepare('SELECT assessment_json FROM ai_assessments WHERE attention_item_id=? ORDER BY generated_at DESC LIMIT 1').get(attentionItemId);
    if (!row) return undefined;
    try { return JSON.parse(String(row.assessment_json)) as AiAssessment; } catch { return undefined; }
  }

  private mapProject(r: any): ProjectRecord {
    return {
      id:String(r.id),organisationId:String(r.organisation_id),code:String(r.code),name:String(r.name),lifecycle:r.lifecycle as ProjectRecord['lifecycle'],
      pmId:String(r.pm_id),...(optional(r.sponsor_id)?{sponsorId:String(r.sponsor_id)}:{}),timezone:String(r.timezone),
      ...(optional(r.baseline_version)?{baselineVersion:String(r.baseline_version)}:{}),baselineAccepted:bool(r.baseline_accepted),
      materialOutcomesConfirmed:bool(r.material_outcomes_confirmed),firstWorkReady:bool(r.first_work_ready),requiredTeamLeadsAssigned:bool(r.required_team_leads_assigned),
      legitimateEvidenceSourceAvailable:bool(r.legitimate_evidence_source_available),...(optional(r.baseline_finish)?{baselineFinish:String(r.baseline_finish)}:{}),
      ...(optional(r.forecast_finish)?{forecastFinish:String(r.forecast_finish)}:{}),...(optional(r.budget)?{budget:Number(r.budget)}:{}),
      ...(optional(r.eac)?{eac:Number(r.eac)}:{}),...(optional(r.currency)?{currency:String(r.currency)}:{}),evidenceConfidence:r.evidence_confidence as ProjectRecord['evidenceConfidence'],
      sourceHealthSummary:String(r.source_health_summary),createdAt:String(r.created_at),updatedAt:String(r.updated_at),revision:Number(r.revision),
    };
  }

  private mapMember(r: any): ProjectMember {
    return {projectId:String(r.project_id),userId:String(r.user_id),displayName:String(r.display_name),role:r.role as ProjectMember['role'],
      ...(optional(r.team_id)?{teamId:String(r.team_id)}:{}),active:bool(r.active),permissions:parseArray(r.permissions_json) as ProjectMember['permissions'],joinedAt:String(r.joined_at)};
  }

  private mapActivity(r: any): ActivityRecord {
    return {id:String(r.id),projectId:String(r.project_id),phase:String(r.phase),title:String(r.title),...(optional(r.description)?{description:String(r.description)}:{}),
      status:r.status as ActivityRecord['status'],...(optional(r.baseline_start)?{baselineStart:String(r.baseline_start)}:{}),...(optional(r.baseline_finish)?{baselineFinish:String(r.baseline_finish)}:{}),
      ...(optional(r.forecast_finish)?{forecastFinish:String(r.forecast_finish)}:{}),...(optional(r.actual_start)?{actualStart:String(r.actual_start)}:{}),...(optional(r.actual_finish)?{actualFinish:String(r.actual_finish)}:{}),
      ...(optional(r.planned_team_id)?{plannedTeamId:String(r.planned_team_id)}:{}),...(optional(r.current_team_id)?{currentTeamId:String(r.current_team_id)}:{}),
      ...(optional(r.owner_id)?{ownerId:String(r.owner_id)}:{}),priority:r.priority as ActivityRecord['priority'],...(optional(r.percent_complete)?{percentComplete:Number(r.percent_complete)}:{}),
      milestone:bool(r.milestone),...(optional(r.source_system)?{sourceSystem:String(r.source_system)}:{}),...(optional(r.source_ref)?{sourceRef:String(r.source_ref)}:{}),
      evidenceRefs:parseArray(r.evidence_refs_json),...(optional(r.blocker)?{blocker:String(r.blocker)}:{}),revision:Number(r.revision)};
  }

  private mapAssignment(r: any): AssignmentRecord {
    return {id:String(r.id),projectId:String(r.project_id),activityId:String(r.activity_id),assigneeId:String(r.assignee_id),
      ...(optional(r.team_id)?{teamId:String(r.team_id)}:{}),supportOwnerIds:parseArray(r.support_owner_ids_json),assignedBy:String(r.assigned_by),effectiveFrom:String(r.effective_from),
      ...(optional(r.ended_at)?{endedAt:String(r.ended_at)}:{}),...(optional(r.reason)?{reason:String(r.reason)}:{}),revision:Number(r.revision)};
  }

  private mapDecision(r: any): DecisionRecord {
    return {id:String(r.id),projectId:String(r.project_id),attentionItemId:String(r.attention_item_id),decisionOwnerId:String(r.decision_owner_id),
      ...(optional(r.decided_by)?{decidedBy:String(r.decided_by)}:{}),state:r.state as DecisionRecord['state'],...(optional(r.choice)?{choice:String(r.choice)}:{}),
      ...(optional(r.reason)?{reason:String(r.reason)}:{}),evidenceRefs:parseArray(r.evidence_refs_json),createdAt:String(r.created_at),
      ...(optional(r.decided_at)?{decidedAt:String(r.decided_at)}:{}),revision:Number(r.revision)};
  }

  private mapHandoff(r: any): HandoffRecord {
    return {id:String(r.id),projectId:String(r.project_id),sourceActivityId:String(r.source_activity_id),targetActivityId:String(r.target_activity_id),
      senderId:String(r.sender_id),receiverId:String(r.receiver_id),deliverableVersion:String(r.deliverable_version),state:r.state as HandoffRecord['state'],
      requiredChecksPassed:Number(r.required_checks_passed),requiredChecksTotal:Number(r.required_checks_total),blockingConditions:parseArray(r.blocking_conditions_json),
      nonBlockingConditions:parseArray(r.non_blocking_conditions_json),attempt:Number(r.attempt),...(optional(r.returned_reason)?{returnedReason:String(r.returned_reason)}:{}),
      ...(optional(r.accepted_at)?{acceptedAt:String(r.accepted_at)}:{}),revision:Number(r.revision)};
  }

  private mapWorkAction(r: any): WorkActionRecord {
    return {id:String(r.id),projectId:String(r.project_id),...(optional(r.attention_item_id)?{attentionItemId:String(r.attention_item_id)}:{}),
      ...(optional(r.activity_id)?{activityId:String(r.activity_id)}:{}),type:r.type as WorkActionRecord['type'],title:String(r.title),ownerId:String(r.owner_id),
      ...(optional(r.due_at)?{dueAt:String(r.due_at)}:{}),state:r.state as WorkActionRecord['state'],createdBy:String(r.created_by),createdAt:String(r.created_at),
      ...(optional(r.completed_at)?{completedAt:String(r.completed_at)}:{}),sourceRefs:parseArray(r.source_refs_json),revision:Number(r.revision)};
  }

  private mapEvent(r: any): ProjectEventRecord {
    return {id:String(r.id),projectId:String(r.project_id),actorId:String(r.actor_id),eventType:String(r.event_type),entityType:String(r.entity_type),entityId:String(r.entity_id),
      result:r.result as ProjectEventRecord['result'],reason:String(r.reason),occurredAt:String(r.occurred_at),correlationId:String(r.correlation_id),
      ...(optional(r.causation_id)?{causationId:String(r.causation_id)}:{}),...(optional(r.before_revision)?{beforeRevision:Number(r.before_revision)}:{}),
      ...(optional(r.after_revision)?{afterRevision:Number(r.after_revision)}:{}),sourceRefs:parseArray(r.source_refs_json),metadata:parseObject(r.metadata_json),
      ...(optional(r.previous_hash)?{previousHash:String(r.previous_hash)}:{}),eventHash:String(r.event_hash)};
  }

  private mapAttention(r: any): AttentionItem {
    const sourceRows = this.db.prepare('SELECT source_ref,source_signal_id FROM attention_sources WHERE attention_item_id=? ORDER BY source_ref,source_signal_id').all(String(r.id));
    const sourceRefs = [...new Set(sourceRows.map((x) => String(x.source_ref)))];
    const sourceSignalIds = [...new Set(sourceRows.map((x) => String(x.source_signal_id)))];
    const aiAssessment = this.getAiAssessment(String(r.id));
    return {id:String(r.id),organisationId:String(r.organisation_id),projectId:String(r.project_id),rootCauseKey:String(r.root_cause_key),title:String(r.title),
      state:r.state as AttentionItem['state'],consequence:r.consequence as AttentionItem['consequence'],confidence:r.confidence as AttentionItem['confidence'],
      situation:String(r.situation),impact:String(r.impact),...(optional(r.owner_id)?{ownerId:String(r.owner_id)}:{}),...(optional(r.decision_owner_id)?{decisionOwnerId:String(r.decision_owner_id)}:{}),
      ...(optional(r.due_at)?{dueAt:String(r.due_at)}:{}),nextAction:r.next_action as AttentionItem['nextAction'],sourceSignalIds,sourceRefs,firstSeenAt:String(r.first_seen_at),
      lastSeenAt:String(r.last_seen_at),...(optional(r.resolved_at)?{resolvedAt:String(r.resolved_at)}:{}),...(aiAssessment?{aiAssessment}:{}),revision:Number(r.revision)};
  }
}

/** Backward-compatible local/test name. The implementation is SQL-port based. */
export class SqliteProjectRepository extends SqlProjectRepository {}

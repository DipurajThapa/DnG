import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  BASELINE_TABLES,
  CURRENT_TABLES,
  PHASE2_TABLES,
  EnterpriseContextService,
  PHASE2_CLOSED_GAPS,
  PHASE2_REMAINING_GAPS,
  ProjectControlService,
  SqliteContextRepository,
  SqliteProjectRepository,
  assessBaseline,
  type ProjectMember,
} from '../src/index.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of [
    '20260910_ai_first_simplification.sql',
    '20260910_role_scoped_project_control.sql',
    '20260910_enterprise_context.sql',
  ]) db.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'));

  const projectRepo = new SqliteProjectRepository(db);
  const projectService = new ProjectControlService(projectRepo, () => new Date('2026-09-10T06:00:00.000Z'));
  let seq = 0;
  const contextRepo = new SqliteContextRepository(db);
  const contextService = new EnterpriseContextService(contextRepo, () => new Date('2026-09-10T06:00:00.000Z'), () => `CTXID-${++seq}`);
  return { db, projectRepo, projectService, contextRepo, contextService };
}

function createProject(projectService: ProjectControlService, id: string, organisationId: string) {
  const members: ProjectMember[] = [
    { projectId:id, userId:`legacy-pm-${id}`, displayName:'Legacy PM', role:'project-manager', active:true, permissions:[], joinedAt:'2026-09-10T06:00:00.000Z' },
  ];
  projectService.createProject({ id, organisationId, code:id, name:`Project ${id}`, pmId:`legacy-pm-${id}`, timezone:'UTC' }, members, 'system');
}

function seedHierarchy() {
  const env = setup();
  const { contextService: s, projectService } = env;
  s.createOrganisation({ id:'ORG1', code:'ORG1', name:'Acme' , active:true}, 'admin');
  s.createOrganisation({ id:'ORG2', code:'ORG2', name:'Other Co', active:true}, 'admin');
  s.createPortfolio({ id:'PF1', organisationId:'ORG1', code:'DIG', name:'Digital Portfolio', active:true }, 'admin');
  s.createPortfolio({ id:'PF2', organisationId:'ORG2', code:'OTH', name:'Other Portfolio', active:true }, 'admin');
  s.createProgram({ id:'PG1', portfolioId:'PF1', code:'CX', name:'Customer Experience', active:true }, 'admin');
  s.createProgram({ id:'PG2', portfolioId:'PF1', code:'DATA', name:'Data Modernisation', active:true }, 'admin');
  s.createProgram({ id:'PGX', portfolioId:'PF2', code:'X', name:'Other Program', active:true }, 'admin');
  s.createOrgUnit({ id:'ENG', organisationId:'ORG1', code:'ENG', name:'Engineering', active:true }, 'admin');
  s.createOrgUnit({ id:'QA', organisationId:'ORG1', parentUnitId:'ENG', code:'QA', name:'Quality Engineering', active:true }, 'admin');

  for (const id of ['A','B','C']) createProject(projectService, id, 'ORG1');
  createProject(projectService, 'X', 'ORG2');
  s.bindProject({ projectId:'A', organisationId:'ORG1', portfolioId:'PF1', programId:'PG1', boundBy:'admin' }, 'admin');
  s.bindProject({ projectId:'B', organisationId:'ORG1', portfolioId:'PF1', programId:'PG1', boundBy:'admin' }, 'admin');
  s.bindProject({ projectId:'C', organisationId:'ORG1', portfolioId:'PF1', programId:'PG2', boundBy:'admin' }, 'admin');
  s.bindProject({ projectId:'X', organisationId:'ORG2', portfolioId:'PF2', programId:'PGX', boundBy:'admin' }, 'admin');
  return env;
}

test('Phase 2 extends one central schema and closes only CTX/HIER/ROLE gaps', () => {
  const phase2Tables = ['ec_organisations','ec_portfolios','ec_programs','ec_org_units','ec_project_context','ec_responsibility_assignments','ec_context_events'];
  assert.equal(BASELINE_TABLES.length + PHASE2_TABLES.length, 36);
  assert.ok(CURRENT_TABLES.length >= 36);
  const phase2Inventory=[...BASELINE_TABLES,...PHASE2_TABLES].map((t)=>t.table);
  const result = assessBaseline(phase2Inventory);
  assert.equal(result.passesCentralTruthInvariant, true);
  assert.deepEqual(result.unclassifiedTables, []);
  for (const table of phase2Tables) assert.ok(CURRENT_TABLES.some((t) => t.table === table));
  assert.deepEqual([...PHASE2_CLOSED_GAPS].sort(), ['CTX-001','HIER-001','ROLE-001'].sort());
  assert.deepEqual(PHASE2_REMAINING_GAPS.map((x) => x.code).sort(), ['FIN-001','RES-001','UX-001'].sort());
});

test('one person can hold multiple responsibility roles in different contexts without a global-role assumption', () => {
  const { contextService:s } = seedHierarchy();
  s.grantResponsibility({ id:'R-PM-A', userId:'alex', displayName:'Alex', role:'project-manager', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.grantResponsibility({ id:'R-SP-B', userId:'alex', displayName:'Alex', role:'sponsor', scopeType:'project', scopeId:'B', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.grantResponsibility({ id:'R-RM-ENG', userId:'alex', displayName:'Alex', role:'resource-manager', scopeType:'org-unit', scopeId:'ENG', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  const contexts = s.listActingContexts('alex');
  assert.equal(contexts.length, 3);
  assert.deepEqual(contexts.map((c) => c.role).sort(), ['project-manager','resource-manager','sponsor'].sort());
});

test('switching acting context materially changes project scope and authority', () => {
  const { contextService:s } = seedHierarchy();
  s.grantResponsibility({ id:'PM-A', userId:'alex', displayName:'Alex', role:'project-manager', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.grantResponsibility({ id:'SP-B', userId:'alex', displayName:'Alex', role:'sponsor', scopeType:'project', scopeId:'B', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  const pm = s.resolveActingContext('alex','PM-A');
  const sponsor = s.resolveActingContext('alex','SP-B');
  assert.deepEqual(pm.accessibleProjectIds, ['A']);
  assert.equal(s.hasPermission(pm,'project:assign'), true);
  assert.equal(s.hasPermission(pm,'money:view-project'), true);
  assert.equal(s.hasPermission(pm,'decision:approve'), false);
  assert.deepEqual(sponsor.accessibleProjectIds, ['B']);
  assert.equal(s.hasPermission(sponsor,'project:assign'), false);
  assert.equal(s.hasPermission(sponsor,'money:view-summary'), true);
  assert.equal(s.hasPermission(sponsor,'decision:approve'), true);
});

test('program and portfolio roles inherit only their hierarchy descendants', () => {
  const { contextService:s } = seedHierarchy();
  s.grantResponsibility({ id:'PGM', userId:'priya', displayName:'Priya', role:'program-manager', scopeType:'program', scopeId:'PG1', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.grantResponsibility({ id:'PFM', userId:'omar', displayName:'Omar', role:'portfolio-manager', scopeType:'portfolio', scopeId:'PF1', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  const pg = s.resolveActingContext('priya','PGM');
  const pf = s.resolveActingContext('omar','PFM');
  assert.deepEqual([...pg.accessibleProjectIds].sort(), ['A','B']);
  assert.equal(s.canAccessProject(pg,'C'), false);
  assert.equal(s.canAccessProject(pg,'X'), false);
  assert.deepEqual([...pf.accessibleProjectIds].sort(), ['A','B','C']);
  assert.equal(s.canAccessProject(pf,'X'), false);
});

test('resource manager follows the functional hierarchy and does not inherit project finance or project management', () => {
  const { contextService:s } = seedHierarchy();
  s.grantResponsibility({ id:'RM', userId:'ravi', displayName:'Ravi', role:'resource-manager', scopeType:'org-unit', scopeId:'ENG', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  const ctx = s.resolveActingContext('ravi','RM');
  assert.deepEqual([...ctx.functionalOrgUnitIds].sort(), ['ENG','QA']);
  assert.deepEqual(ctx.accessibleProjectIds, []);
  assert.equal(s.hasPermission(ctx,'resource:allocate'), true);
  assert.equal(s.hasPermission(ctx,'money:view-project'), false);
  assert.equal(s.hasPermission(ctx,'project:manage'), false);
});

test('optional project-director and agile-delivery roles are explicit without becoming mandatory layers', () => {
  const { contextService:s } = seedHierarchy();
  s.grantResponsibility({ id:'PD', userId:'dir', displayName:'Director', role:'project-director', scopeType:'program', scopeId:'PG1', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.grantResponsibility({ id:'AG', userId:'scrum', displayName:'Scrum', role:'agile-delivery-lead', scopeType:'project', scopeId:'A', teamId:'dev', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  const director = s.resolveActingContext('dir','PD');
  const agile = s.resolveActingContext('scrum','AG');
  assert.deepEqual([...director.accessibleProjectIds].sort(), ['A','B']);
  assert.equal(s.hasPermission(director,'money:view-commercial'), true);
  assert.equal(agile.teamId, 'dev');
  assert.equal(s.hasPermission(agile,'team:coordinate'), true);
  assert.equal(s.hasPermission(agile,'project:assign'), false);
});

test('role-to-scope rules reject invalid responsibility assignments instead of broadening access', () => {
  const { contextService:s } = seedHierarchy();
  assert.throws(() => s.grantResponsibility({ id:'BAD1', userId:'x', displayName:'X', role:'project-manager', scopeType:'organisation', scopeId:'ORG1', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin'), /cannot be assigned/i);
  assert.throws(() => s.grantResponsibility({ id:'BAD2', userId:'x', displayName:'X', role:'delivery-lead', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin'), /teamId/i);
  assert.throws(() => s.grantResponsibility({ id:'BAD3', userId:'x', displayName:'X', role:'portfolio-manager', scopeType:'portfolio', scopeId:'MISSING', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin'), /does not exist/i);
});

test('project hierarchy binding rejects cross-organisation program/portfolio combinations', () => {
  const env = setup();
  const { contextService:s, projectService } = env;
  s.createOrganisation({ id:'O1', code:'O1', name:'One', active:true}, 'admin');
  s.createOrganisation({ id:'O2', code:'O2', name:'Two', active:true}, 'admin');
  s.createPortfolio({ id:'P1', organisationId:'O1', code:'P1', name:'P1', active:true}, 'admin');
  s.createPortfolio({ id:'P2', organisationId:'O2', code:'P2', name:'P2', active:true}, 'admin');
  s.createProgram({ id:'G2', portfolioId:'P2', code:'G2', name:'G2', active:true}, 'admin');
  createProject(projectService,'A','O1');
  assert.throws(() => s.bindProject({ projectId:'A', organisationId:'O1', portfolioId:'P2', programId:'G2', boundBy:'admin' }, 'admin'), /does not belong/i);
});

test('revoked or expired responsibilities disappear from available acting contexts', () => {
  const { contextService:s } = seedHierarchy();
  s.grantResponsibility({ id:'PM', userId:'alex', displayName:'Alex', role:'project-manager', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  assert.equal(s.listActingContexts('alex').length, 1);
  s.revokeResponsibility('PM','admin','Role ended');
  assert.equal(s.listActingContexts('alex').length, 0);
  assert.throws(() => s.resolveActingContext('alex','PM'), /inactive/i);
});

test('duplicate active role assignments for the same user/context are rejected by the database', () => {
  const { contextService:s } = seedHierarchy();
  s.grantResponsibility({ id:'PM1', userId:'alex', displayName:'Alex', role:'project-manager', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  assert.throws(() => s.grantResponsibility({ id:'PM2', userId:'alex', displayName:'Alex', role:'project-manager', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin'));
});

test('context changes are append-only, hash-chained and attributable', () => {
  const { contextService:s, contextRepo:r, db } = seedHierarchy();
  s.grantResponsibility({ id:'PM', userId:'alex', displayName:'Alex', role:'project-manager', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.revokeResponsibility('PM','admin','Moved to another project');
  const events = r.listEvents();
  assert.ok(events.length >= 2);
  assert.equal(r.verifyEventChain(), true);
  assert.equal(events.some((e) => e.eventType === 'responsibility.granted' && e.assignmentId === 'PM'), true);
  assert.equal(events.some((e) => e.eventType === 'responsibility.revoked' && e.assignmentId === 'PM'), true);
  assert.throws(() => db.prepare('DELETE FROM ec_context_events').run(), /append-only/);
  assert.throws(() => db.prepare("UPDATE ec_context_events SET reason='tampered'").run(), /append-only/);
});


test('backend authorization evaluates only the selected acting context and records denied cross-scope access', () => {
  const { contextService:s, contextRepo:r } = seedHierarchy();
  s.grantResponsibility({ id:'PM-AUTH', userId:'alex', displayName:'Alex', role:'project-manager', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.grantResponsibility({ id:'SP-AUTH', userId:'alex', displayName:'Alex', role:'sponsor', scopeType:'project', scopeId:'B', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');

  const allowed = s.authorizeProject('alex','PM-AUTH','A','project:assign');
  assert.equal(allowed.role, 'project-manager');
  assert.throws(() => s.authorizeProject('alex','PM-AUTH','B','project:view-full'), /outside the selected responsibility context/i);
  assert.throws(() => s.authorizeProject('alex','SP-AUTH','B','project:assign'), /not permitted/i);

  const denied = r.listEvents().filter((e) => e.result === 'denied');
  assert.equal(denied.some((e) => e.eventType === 'context.project-access-denied' && e.scopeId === 'B'), true);
  assert.equal(denied.some((e) => e.eventType === 'context.project-action-denied' && e.scopeId === 'B'), true);
  assert.equal(r.verifyEventChain(), true);
});


test('revocation is idempotent and does not create duplicate administrative audit noise', () => {
  const { contextService:s, contextRepo:r } = seedHierarchy();
  s.grantResponsibility({ id:'PM-IDEM', userId:'alex', displayName:'Alex', role:'project-manager', scopeType:'project', scopeId:'A', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.revokeResponsibility('PM-IDEM','admin','Role ended');
  const afterFirst = r.listEvents().filter((e) => e.eventType === 'responsibility.revoked' && e.assignmentId === 'PM-IDEM').length;
  s.revokeResponsibility('PM-IDEM','admin','Role ended');
  const afterSecond = r.listEvents().filter((e) => e.eventType === 'responsibility.revoked' && e.assignmentId === 'PM-IDEM').length;
  assert.equal(afterFirst, 1);
  assert.equal(afterSecond, 1);
});

test('organisation-scoped PMO inherits project/control scope while enterprise admin remains administration-only', () => {
  const { contextService:s } = seedHierarchy();
  s.grantResponsibility({ id:'PMO-ORG', userId:'pmo', displayName:'PMO', role:'pmo', scopeType:'organisation', scopeId:'ORG1', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  s.grantResponsibility({ id:'ADMIN-ORG', userId:'ent', displayName:'Enterprise Admin', role:'enterprise-admin', scopeType:'organisation', scopeId:'ORG1', permissions:[], effectiveFrom:'2026-09-01T00:00:00.000Z' }, 'admin');
  const pmo = s.resolveActingContext('pmo','PMO-ORG');
  const admin = s.resolveActingContext('ent','ADMIN-ORG');
  assert.deepEqual([...pmo.accessibleProjectIds].sort(), ['A','B','C']);
  assert.equal(s.hasPermission(pmo,'governance:manage'), true);
  assert.deepEqual(admin.accessibleProjectIds, []);
  assert.equal(s.hasPermission(admin,'context:admin'), true);
});

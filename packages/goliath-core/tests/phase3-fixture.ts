import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ActingContextBoundary,
  ContextualProjectApplication,
  EnterpriseContextService,
  FinanceService,
  ProjectControlService,
  ResourceCapacityService,
  RoleExperienceService,
  SqliteContextRepository,
  SqliteFinanceRepository,
  SqliteProjectRepository,
  SqliteResourceRepository,
  type ProjectMember,
} from '../src/index.js';

export function phase3Fixture() {
  const db=new DatabaseSync(':memory:');
  for (const file of [
    '20260910_ai_first_simplification.sql',
    '20260910_role_scoped_project_control.sql',
    '20260910_enterprise_context.sql',
    '20260910_phase3_resource_finance.sql',
  ]) db.exec(readFileSync(new URL(`../../migrations/${file}`,import.meta.url),'utf8'));
  const now=()=>new Date('2026-09-10T08:00:00.000Z');
  const projectRepo=new SqliteProjectRepository(db);
  const projectService=new ProjectControlService(projectRepo,now);
  let seq=0;
  const contextRepo=new SqliteContextRepository(db);
  const contextService=new EnterpriseContextService(contextRepo,now,()=>`CTX-${++seq}`);
  const boundary=new ActingContextBoundary(contextService);
  const resourceRepo=new SqliteResourceRepository(db);
  const resourceService=new ResourceCapacityService(boundary,contextService,resourceRepo,projectRepo,now);
  const financeRepo=new SqliteFinanceRepository(db);
  const financeService=new FinanceService(boundary,contextService,financeRepo,projectRepo,now);
  const projectApp=new ContextualProjectApplication(boundary,projectRepo,projectService);
  const experienceService=new RoleExperienceService(boundary,projectRepo,resourceService,financeService,now);

  contextService.createOrganisation({id:'ORG1',code:'ORG1',name:'Acme',active:true},'admin');
  contextService.createPortfolio({id:'PF1',organisationId:'ORG1',code:'DIG',name:'Digital Portfolio',active:true},'admin');
  contextService.createProgram({id:'PG1',portfolioId:'PF1',code:'CX',name:'Customer Experience',active:true},'admin');
  contextService.createOrgUnit({id:'ENG',organisationId:'ORG1',code:'ENG',name:'Engineering',active:true},'admin');
  contextService.createOrgUnit({id:'QA',organisationId:'ORG1',parentUnitId:'ENG',code:'QA',name:'Quality Engineering',active:true},'admin');

  const createProject=(id:string,name:string)=>{
    const members:ProjectMember[]=[
      {projectId:id,userId:'alex',displayName:'Alex PM',role:'project-manager',teamId:'pmo',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
      {projectId:id,userId:'bob',displayName:'Bob Sponsor',role:'sponsor',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
      {projectId:id,userId:'program1',displayName:'Program Manager',role:'program-manager',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
      {projectId:id,userId:'pmo1',displayName:'PMO',role:'pmo',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
      {projectId:id,userId:'devlead',displayName:'Dev Lead',role:'delivery-lead',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
      {projectId:id,userId:'agile',displayName:'Agile Lead',role:'delivery-lead',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
      {projectId:id,userId:'dev1',displayName:'Developer',role:'team-member',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
      {projectId:id,userId:'qa1',displayName:'QA Analyst',role:'team-member',teamId:'qa',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    ];
    projectService.createProject({id,organisationId:'ORG1',code:id,name,pmId:'alex',sponsorId:'bob',timezone:'UTC',baselineFinish:'2026-11-30',budget:100000,currency:'USD'},members,'system');
    projectService.importPlan(id,'alex',[
      {id:`${id}-D1`,projectId:id,phase:'Build',title:'Build core',status:'in-progress',plannedTeamId:'dev',currentTeamId:'dev',ownerId:'dev1',priority:'high',milestone:false,baselineFinish:'2026-09-20',forecastFinish:'2026-09-20',sourceSystem:'Jira',sourceRef:`JIRA-${id}-1`,evidenceRefs:[`JIRA-${id}-1`]},
      {id:`${id}-D2`,projectId:id,phase:'Build',title:'Integration complete',status:'not-started',plannedTeamId:'dev',currentTeamId:'dev',ownerId:'dev1',priority:'medium',milestone:true,baselineFinish:'2026-09-25',forecastFinish:'2026-09-25',sourceSystem:'Jira',sourceRef:`JIRA-${id}-2`,evidenceRefs:[`JIRA-${id}-2`]},
      {id:`${id}-Q1`,projectId:id,phase:'Test',title:'System test',status:'blocked',plannedTeamId:'qa',currentTeamId:'qa',ownerId:'qa1',priority:'critical',milestone:true,baselineFinish:'2026-10-02',forecastFinish:'2026-10-08',sourceSystem:'QA',sourceRef:`QA-${id}-1`,evidenceRefs:[`QA-${id}-1`],blocker:'Awaiting stable build'},
    ],[
      {id:`${id}-DEP1`,projectId:id,predecessorActivityId:`${id}-D2`,successorActivityId:`${id}-Q1`,gateType:'finish-to-start',mandatory:true},
    ]);
    contextService.bindProject({projectId:id,organisationId:'ORG1',portfolioId:'PF1',programId:'PG1',boundBy:'admin'},'admin');
  };
  createProject('A','Project Alpha');
  createProject('B','Project Beta');

  const grant=(id:string,userId:string,displayName:string,role:any,scopeType:any,scopeId:string,teamId?:string,permissions:any[]=[])=>
    contextService.grantResponsibility({id,userId,displayName,role,scopeType,scopeId,...(teamId?{teamId}:{}),permissions,effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  grant('PM-A','alex','Alex PM','project-manager','project','A');
  grant('SP-A-ALEX','alex','Alex PM','sponsor','project','A');
  grant('SP-A','bob','Bob Sponsor','sponsor','project','A');
  grant('PROGRAM','program1','Program Manager','program-manager','program','PG1');
  grant('PORT','portfolio1','Portfolio Manager','portfolio-manager','portfolio','PF1');
  grant('DIR','director1','Project Director','project-director','program','PG1');
  grant('PMO','pmo1','PMO','pmo','organisation','ORG1');
  grant('RM','rm1','Resource Manager','resource-manager','org-unit','ENG');
  grant('LEAD','devlead','Dev Lead','delivery-lead','project','A','dev');
  grant('AGILE','agile','Agile Lead','agile-delivery-lead','project','A','dev');
  grant('MEMBER','dev1','Developer','team-member','project','A','dev');
  grant('ADMIN','admin1','Enterprise Admin','enterprise-admin','organisation','ORG1');

  return {db,now,projectRepo,projectService,contextRepo,contextService,boundary,resourceRepo,resourceService,financeRepo,financeService,projectApp,experienceService};
}

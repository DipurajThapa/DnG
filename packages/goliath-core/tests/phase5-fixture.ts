import { readFileSync } from 'node:fs';
import {
  AcceptanceIdentityProvider,
  DeterministicFallbackAi,
  GoliathRuntimeHttpServer,
  EnterpriseEventIntelligenceService,
  HmacSessionService,
  JiraCloudWebhookAdapter,
  ProjectControlCoordinator,
  ProviderQueueWorker,
  ProviderWebhookGateway,
  QaWebhookAdapter,
  RepositoryEvidenceResolver,
  ResourceCapacitySignalProvider,
  SqliteProviderRuntimeRepository,
  StaticWebhookSecretProvider,
  ErpFinanceWebhookAdapter,
  WorkforceWebhookAdapter,
  type ProjectMember,
} from '../src/index.js';
import { phase3Fixture } from './phase3-fixture.js';

export function phase5Fixture(){
  const env=phase3Fixture();
  for(const file of ['20260909_b14_b16.sql','20260910_phase5_provider_runtime.sql']) env.db.exec(readFileSync(new URL(`../../migrations/${file}`,import.meta.url),'utf8'));
  const projectId='F5';
  const members:ProjectMember[]=[
    {projectId,userId:'f5-pm',displayName:'Faye PM',role:'project-manager',teamId:'pmo',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'f5-sponsor',displayName:'Sam Sponsor',role:'sponsor',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'f5-devlead',displayName:'Dev Lead',role:'delivery-lead',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'f5-qalead',displayName:'QA Lead',role:'delivery-lead',teamId:'qa',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'f5-dev',displayName:'Developer',role:'team-member',teamId:'dev',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
    {projectId,userId:'f5-qa',displayName:'QA Analyst',role:'team-member',teamId:'qa',active:true,permissions:[],joinedAt:'2026-09-10T08:00:00.000Z'},
  ];
  env.projectService.createProject({id:projectId,organisationId:'ORG1',code:'F5',name:'Provider Runtime Project',pmId:'f5-pm',sponsorId:'f5-sponsor',timezone:'UTC',baselineFinish:'2026-10-31',budget:100000,currency:'USD'},members,'system');
  env.contextService.bindProject({projectId,organisationId:'ORG1',portfolioId:'PF1',programId:'PG1',boundBy:'admin'},'admin');
  const grant=(id:string,userId:string,name:string,role:any,scopeType:any,scopeId:string,teamId?:string)=>env.contextService.grantResponsibility({id,userId,displayName:name,role,scopeType,scopeId,...(teamId?{teamId}:{}),permissions:[],effectiveFrom:'2026-09-01T00:00:00.000Z'},'admin');
  grant('F5-PM','f5-pm','Faye PM','project-manager','project',projectId);
  grant('F5-SP','f5-sponsor','Sam Sponsor','sponsor','project',projectId);
  grant('F5-DL','f5-devlead','Dev Lead','delivery-lead','project',projectId,'dev');
  grant('F5-QL','f5-qalead','QA Lead','delivery-lead','project',projectId,'qa');
  grant('F5-DEV','f5-dev','Developer','team-member','project',projectId,'dev');
  grant('F5-QA','f5-qa','QA Analyst','team-member','project',projectId,'qa');
  const pm={userId:'f5-pm',actingAssignmentId:'F5-PM'};
  env.projectApp.importPlan(pm,projectId,[
    {id:'F5-D1',projectId,phase:'Build',title:'Build runtime feature',status:'in-progress',plannedTeamId:'dev',currentTeamId:'dev',priority:'high',milestone:false,baselineFinish:'2026-09-20',forecastFinish:'2026-09-20',sourceSystem:'Jira',sourceRef:'JIRA:F5-D1',evidenceRefs:['JIRA:F5-D1']},
    {id:'F5-Q1',projectId,phase:'Test',title:'Runtime acceptance',status:'not-started',plannedTeamId:'qa',currentTeamId:'qa',priority:'critical',milestone:true,baselineFinish:'2026-09-25',forecastFinish:'2026-09-25',sourceSystem:'QA',sourceRef:'QA:F5-Q1',evidenceRefs:['QA:F5-Q1']},
  ],[{id:'F5-DEP',projectId,predecessorActivityId:'F5-D1',successorActivityId:'F5-Q1',gateType:'finish-to-start',mandatory:true}]);
  env.projectApp.assignActivity(pm,projectId,'F5-D1','f5-dev');
  env.projectApp.assignActivity(pm,projectId,'F5-Q1','f5-qa');
  env.projectApp.configureProject(pm,projectId,{baselineVersion:'F5-BASE-1',baselineAccepted:true,materialOutcomesConfirmed:true});
  env.projectApp.registerSource(pm,projectId,{id:'F5-JIRA-SRC',projectId,sourceType:'delivery',sourceRef:'JIRA:F5-D1',authority:'delivery status',status:'current',lastObservedAt:'2026-09-10T08:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  env.projectApp.registerSource(pm,projectId,{id:'F5-QA-SRC',projectId,sourceType:'quality',sourceRef:'QA:F5-Q1',authority:'quality acceptance',status:'current',lastObservedAt:'2026-09-10T08:00:00.000Z',freshnessHours:24,classification:'internal',revision:1});
  env.projectService.refreshDerivedProjectState(projectId);
  env.projectApp.transitionProject(pm,projectId,'ready'); env.projectApp.transitionProject(pm,projectId,'active');
  const rm={userId:'rm1',actingAssignmentId:'RM'};
  env.resourceService.createResource(rm,{id:'R-F5',userId:'f5-dev',displayName:'Developer',organisationId:'ORG1',orgUnitId:'ENG',active:true,skills:['TypeScript'],weeklyContractHours:40});
  env.resourceService.requestDemand(pm,{id:'DEM-F5',projectId,teamId:'dev',orgUnitId:'ENG',skill:'TypeScript',periodStart:'2026-09-10',periodEnd:'2026-09-16',requiredHours:24});
  env.financeService.setForecast(pm,{projectId,etcAmount:70000,contingencyAmount:5000,currency:'USD',asOf:'2026-09-10T08:00:00.000Z',sourceRefs:['FORECAST:F5']});

  const bindingRows=[
    ['F5-B-JIRA','delivery','jira-cloud','prod'],['F5-B-QA','qa','qa-system','prod'],['F5-B-ERP','finance','erp-finance','prod'],['F5-B-WFM','workforce','workforce','prod'],
  ];
  for(const [id,domain,provider,environment] of bindingRows) env.db.prepare(`INSERT INTO integration_bindings_v2(id,organisation_id,project_id,domain,provider,environment,enabled,authority_mode,inbound_fields_json,outbound_actions_json,classification,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,'automatic-approved','[]','[]','internal',1,?,?)`).run(id,'ORG1',projectId,domain,provider,environment,env.now().toISOString(),env.now().toISOString());
  const mappings=[
    ['F5-M-JIRA','F5-B-JIRA','jira-prod','prod','issue','F5-D1','activity','F5-D1'],
    ['F5-M-QA','F5-B-QA','qa-prod','prod','test-run','F5-Q1','activity','F5-Q1'],
    ['F5-M-ERP','F5-B-ERP','erp-prod','prod','finance-entry','ACT-1','finance-entry','ACT-1'],
    ['F5-M-WCAP','F5-B-WFM','wfm-prod','prod','capacity','R-F5','resource','R-F5'],
    ['F5-M-WALLOC','F5-B-WFM','wfm-prod','prod','allocation','ALLOC-F5','allocation','ALLOC-F5'],
  ];
  for(const m of mappings) env.db.prepare(`INSERT INTO external_object_links_v2(id,organisation_id,project_id,binding_id,provider_account_id,provider_environment,resource_type,external_id,local_entity_type,local_entity_id,mapping_version,effective_from) VALUES(?,'ORG1',?,?,?,?,?,?,?,?,1,'2026-09-01T00:00:00.000Z')`).run(m[0],projectId,...m.slice(1));

  const provider=new ResourceCapacitySignalProvider(env.resourceRepo,env.projectRepo);
  const coordinator=new ProjectControlCoordinator(env.projectRepo,new DeterministicFallbackAi(),new RepositoryEvidenceResolver(),env.now,[provider]);
  const events=new EnterpriseEventIntelligenceService(env.projectRepo,env.projectService,env.resourceService,env.financeService,coordinator,env.now);
  const runtimeRepo=new SqliteProviderRuntimeRepository(env.db,env.now);
  const secrets=new StaticWebhookSecretProvider({
    'F5-B-JIRA':{secret:'jira-secret-for-phase5-runtime',keyId:'jira-k1'},
    'F5-B-QA':{secret:'qa-secret-for-phase5-runtime-01',keyId:'qa-k1'},
    'F5-B-ERP':{secret:'erp-secret-for-phase5-runtime',keyId:'erp-k1'},
    'F5-B-WFM':{secret:'wfm-secret-for-phase5-runtime',keyId:'wfm-k1'},
  });
  const adapters={
    'jira-cloud':new JiraCloudWebhookAdapter(),
    'qa-system':new QaWebhookAdapter(),
    'erp-finance':new ErpFinanceWebhookAdapter(),
    'workforce':new WorkforceWebhookAdapter(),
  };
  const webhooks=new ProviderWebhookGateway(runtimeRepo,adapters,secrets,env.now);
  const queue=new ProviderQueueWorker(runtimeRepo,events,env.now,3);
  const sessions=new HmacSessionService('phase5-session-signing-secret-0001',env.now,3600);
  const identity=new AcceptanceIdentityProvider([
    {userId:'f5-pm',displayName:'Faye PM',password:'pm-pass'},
    {userId:'f5-sponsor',displayName:'Sam Sponsor',password:'sponsor-pass'},
    {userId:'f5-devlead',displayName:'Dev Lead',password:'lead-pass'},
    {userId:'f5-qalead',displayName:'QA Lead',password:'qalead-pass'},
    {userId:'f5-dev',displayName:'Developer',password:'member-pass'},
    {userId:'rm1',displayName:'Resource Manager',password:'rm-pass'},
    {userId:'program1',displayName:'Program Manager',password:'program-pass'},
    {userId:'portfolio1',displayName:'Portfolio Manager',password:'portfolio-pass'},
    {userId:'pmo1',displayName:'PMO',password:'pmo-pass'},
    {userId:'admin1',displayName:'Enterprise Admin',password:'admin-pass'},
  ],sessions);
  const server=new GoliathRuntimeHttpServer({identity,sessions,contexts:env.contextService,experiences:env.experienceService,projectApp:env.projectApp,resources:env.resourceService,webhooks,queue,control:coordinator});
  return {...env,projectId,pm,rm,events,runtimeRepo,webhooks,queue,sessions,identity,server,secrets};
}

export function signedHeaders(signature:string,accountId:string,eventId?:string,effectiveAt?:string){return {'x-goliath-signature':signature,'x-goliath-account-id':accountId,...(eventId?{'x-goliath-event-id':eventId}:{}),...(effectiveAt?{'x-goliath-effective-at':effectiveAt}:{})};}

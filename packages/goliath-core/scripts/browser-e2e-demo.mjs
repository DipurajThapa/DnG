import { AcceptanceIdentityProvider, GoliathRuntimeHttpServer } from '../dist/src/index.js';
import { phase5Fixture } from '../dist/tests/phase5-fixture.js';

const env=phase5Fixture();
// Give the Resource Manager a real capacity basis for browser allocation journeys.
try {
  env.resourceService.setCapacity(env.rm,{id:'CAP-BROWSER',resourceId:'R-F5',periodStart:'2026-09-10',periodEnd:'2026-09-30',grossHours:120,unavailableHours:8});
} catch {}
const identity=new AcceptanceIdentityProvider([
  {userId:'f5-pm',displayName:'Faye PM',password:'pm-pass'},
  {userId:'f5-sponsor',displayName:'Sam Sponsor',password:'sponsor-pass'},
  {userId:'program1',displayName:'Program Manager',password:'program-pass'},
  {userId:'portfolio1',displayName:'Portfolio Manager',password:'portfolio-pass'},
  {userId:'director1',displayName:'Project Director',password:'director-pass'},
  {userId:'pmo1',displayName:'PMO',password:'pmo-pass'},
  {userId:'rm1',displayName:'Resource Manager',password:'rm-pass'},
  {userId:'f5-devlead',displayName:'Dev Lead',password:'lead-pass'},
  {userId:'agile',displayName:'Agile Lead',password:'agile-pass'},
  {userId:'f5-dev',displayName:'Developer',password:'member-pass'},
  {userId:'f5-qa',displayName:'QA Analyst',password:'qa-pass'},
  {userId:'admin1',displayName:'Enterprise Admin',password:'admin-pass'},
],env.sessions);
const server=new GoliathRuntimeHttpServer({
  identity,sessions:env.sessions,contexts:env.contextService,experiences:env.experienceService,
  projectApp:env.projectApp,resources:env.resourceService,webhooks:env.webhooks,queue:env.queue,
});
const runtime=await server.listen(Number(process.env.PORT||3100),process.env.HOST||'127.0.0.1');
console.log(runtime.url);
const stop=async()=>{await server.close();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);

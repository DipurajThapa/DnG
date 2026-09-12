import { connectPostgresRuntimeCore } from '../dist/src/production/postgres-runtime.js';

const url=process.env.DATABASE_URL?.trim();
if(!url){console.error(JSON.stringify({ready:false,message:'DATABASE_URL is required.'}));process.exitCode=1;}
else{
  let runtime;
  try{
    runtime=await connectPostgresRuntimeCore(url);
    const tableCount=Number(runtime.db.prepare("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public'").get()?.n??0);
    const appendColumns=Number(runtime.db.prepare("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('pc_project_events','ec_context_events') AND column_name='append_seq'").get()?.n??0);
    const projects=Number(runtime.db.prepare('SELECT COUNT(*) AS n FROM pc_projects').get()?.n??0);
    console.log(JSON.stringify({ready:tableCount===43&&appendColumns===2,tableCount,appendOrderColumns:appendColumns,projectCount:projects,persistence:'postgres-sync'}));
    if(tableCount!==43||appendColumns!==2)process.exitCode=1;
  }catch(error){console.error(JSON.stringify({ready:false,message:error instanceof Error?error.message:String(error)}));process.exitCode=1;}
  finally{runtime?.db.close();}
}

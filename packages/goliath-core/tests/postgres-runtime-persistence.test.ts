import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PostgresSyncDatabase,
  connectPostgresSyncDatabase,
  translateRepositorySql,
  SqlProjectRepository,
  type SyncPostgresClient,
} from '../src/index.js';

class FakePgClient implements SyncPostgresClient {
  connected: string | undefined;
  ended = false;
  readonly queries: { sql:string; params:readonly any[] }[] = [];
  readonly responders: ((sql:string,params:readonly any[])=>any[]|undefined)[] = [];
  connectSync(connectionString?: string): void { this.connected=connectionString; }
  querySync(sql:string, params:readonly any[]=[]): any[] {
    this.queries.push({sql,params});
    for(const responder of this.responders){const result=responder(sql,params);if(result!==undefined)return result;}
    return [];
  }
  end(): void { this.ended=true; }
}

test('PostgreSQL repository SQL translation preserves literals, parameters, append order and INSERT OR IGNORE semantics',()=>{
  const select=translateRepositorySql("SELECT * FROM pc_project_events WHERE project_id=? AND reason='literal ?' ORDER BY rowid DESC LIMIT 1");
  assert.match(select,/project_id=\$1/);assert.match(select,/reason='literal \?'/);assert.match(select,/ORDER BY append_seq DESC/);
  const insert=translateRepositorySql('INSERT OR IGNORE INTO attention_sources(attention_item_id,source_ref,source_signal_id) VALUES(?,?,?)');
  assert.equal(insert,'INSERT INTO attention_sources(attention_item_id,source_ref,source_signal_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING');
  assert.equal(translateRepositorySql('BEGIN IMMEDIATE'),'BEGIN');
});

test('PostgresSyncDatabase exposes DatabaseSync-compatible get/all/run behavior over a PostgreSQL sync client',()=>{
  const client=new FakePgClient();
  client.responders.push((sql)=>sql.startsWith('SELECT')?[{id:'P1'}]:undefined);
  client.responders.push((sql)=>sql.includes('RETURNING 1 AS __goliath_changed')?[{__goliath_changed:1}]:undefined);
  const db=new PostgresSyncDatabase(client);
  assert.deepEqual(db.prepare('SELECT id FROM pc_projects WHERE id=?').get('P1'),{id:'P1'});
  assert.deepEqual(db.prepare('SELECT id FROM pc_projects WHERE id=?').all('P1'),[{id:'P1'}]);
  const result=db.prepare('UPDATE pc_projects SET name=? WHERE id=?').run('Name','P1');
  assert.equal(Number(result.changes),1);
  assert.ok(client.queries.some(q=>q.sql.includes('name=$1')&&q.sql.includes('id=$2')));
});

test('PostgreSQL connection factory fails closed on invalid URL/version and accepts PostgreSQL 17',async()=>{
  await assert.rejects(()=>connectPostgresSyncDatabase('sqlite://local',async()=>FakePgClient as any),/PostgreSQL runtime requires/i);
  let created:FakePgClient|undefined;
  class Pg17 extends FakePgClient { constructor(){super();created=this;this.responders.push(sql=>sql.includes("server_version_num")?[{server_version_num:'170000'}]:undefined);} }
  const db=await connectPostgresSyncDatabase('postgresql://user:pass@example/db',async()=>Pg17 as any);
  assert.equal(created?.connected,'postgresql://user:pass@example/db');db.close();assert.equal(created?.ended,true);
  class Pg13 extends FakePgClient { constructor(){super();this.responders.push(sql=>sql.includes("server_version_num")?[{server_version_num:'130000'}]:undefined);} }
  await assert.rejects(()=>connectPostgresSyncDatabase('postgresql://user:pass@example/db',async()=>Pg13 as any),/PostgreSQL 14 or newer/i);
});

test('existing project repository runs unchanged over PostgreSQL adapter and uses durable append_seq ordering',()=>{
  const client=new FakePgClient();
  client.responders.push((sql)=>{
    if(sql.startsWith('SELECT * FROM pc_projects'))return [{
      id:'P1',organisation_id:'ORG1',code:'P1',name:'Project',lifecycle:'active',pm_id:'pm',sponsor_id:null,timezone:'UTC',baseline_version:null,
      baseline_accepted:1,material_outcomes_confirmed:1,first_work_ready:1,required_team_leads_assigned:1,legitimate_evidence_source_available:1,
      baseline_finish:null,forecast_finish:null,budget:null,eac:null,currency:null,evidence_confidence:'high',source_health_summary:'Current',created_at:'2026-09-11T00:00:00.000Z',updated_at:'2026-09-11T00:00:00.000Z',revision:1,
    }];
    if(sql.includes('SELECT event_hash FROM pc_project_events'))return [];
    if(sql.includes('INSERT INTO pc_project_events')&&sql.includes('RETURNING'))return [{__goliath_changed:1}];
    return undefined;
  });
  const repo=new SqlProjectRepository(new PostgresSyncDatabase(client));
  assert.equal(repo.getProject('P1')?.organisationId,'ORG1');
  repo.appendEvent({id:'E1',projectId:'P1',actorId:'pm',eventType:'test',entityType:'project',entityId:'P1',result:'recorded',reason:'test',occurredAt:'2026-09-11T00:00:00.000Z',correlationId:'C1',sourceRefs:[]});
  assert.ok(client.queries.some(q=>q.sql.includes('ORDER BY append_seq DESC')));
  assert.ok(client.queries.some(q=>q.sql.includes('INSERT INTO pc_project_events')));
});

test('PostgreSQL translator handles quoted apostrophes, quoted identifiers and semicolon INSERT OR IGNORE safely',()=>{
  const q=translateRepositorySql("SELECT \"?column\" FROM t WHERE note='it''s ? literal' AND id=?");
  assert.equal(q,"SELECT \"?column\" FROM t WHERE note='it''s ? literal' AND id=$1");
  const insert=translateRepositorySql('INSERT OR IGNORE INTO t(a) VALUES(?);');
  assert.equal(insert,'INSERT INTO t(a) VALUES($1) ON CONFLICT DO NOTHING;');
});

test('PostgreSQL adapter exec/close and version failure paths are fail closed',async()=>{
  const client=new FakePgClient();const db=new PostgresSyncDatabase(client);db.exec('BEGIN IMMEDIATE');db.exec('COMMIT');db.close();
  assert.equal(client.queries[0]?.sql,'BEGIN');assert.equal(client.queries[1]?.sql,'COMMIT');assert.equal(client.ended,true);
  class NoConnect extends FakePgClient { connectSync=undefined as any; }
  await assert.rejects(()=>connectPostgresSyncDatabase('postgresql://u:p@example/db',async()=>NoConnect as any),/does not support synchronous connections/i);
  class NoVersion extends FakePgClient { constructor(){super();this.responders.push(sql=>sql.includes('server_version_num')?[]:undefined);} }
  await assert.rejects(()=>connectPostgresSyncDatabase('postgresql://u:p@example/db',async()=>NoVersion as any),/PostgreSQL 14 or newer/i);
});

test('PostgreSQL runtime core constructs the existing domain stack over the SQL port without business-rule forks',async()=>{
  let created:FakePgClient|undefined;
  class Pg17Core extends FakePgClient { constructor(){super();created=this;this.responders.push(sql=>sql.includes('server_version_num')?[{server_version_num:'170000'}]:undefined);} }
  const {connectPostgresRuntimeCore}=await import('../src/index.js');
  const runtime=await connectPostgresRuntimeCore('postgresql://u:p@example/db',{clientLoader:async()=>Pg17Core as any,now:()=>new Date('2026-09-11T00:00:00.000Z')});
  assert.ok(runtime.projectRepo);assert.ok(runtime.contextService);assert.ok(runtime.resourceService);assert.ok(runtime.financeService);assert.ok(runtime.projectApp);assert.ok(runtime.experienceService);assert.ok(runtime.providerRuntimeRepo);
  assert.equal(runtime.db.client,created);runtime.db.close();
});

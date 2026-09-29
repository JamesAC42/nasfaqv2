const assert = require("node:assert/strict");
const test = require("node:test");
const { Pool, Client } = require("pg");
const { randomUUID } = require("node:crypto");
const jobs = require("../src/services/rebuildJobs");
const batch = require("../src/services/settlementBatch");
const legacy = require("./fixtures/settlement-reference");
const health = require("../src/services/schedulerHealth");
const quiet = { error() {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("worker heartbeat is shared and disabled web replicas cannot overwrite it", async () => {
  const values = new Map();
  const redis = { async set(k,v) { values.set(k,v); }, async get(k) { return values.get(k); } };
  const previousOwner = process.env.SCHEDULER_STATUS_OWNER;
  delete process.env.SCHEDULER_STATUS_OWNER;
  const worker = health.startSchedulerHeartbeat(redis, "adjustment", { enabled: true, intervalMs: 60000 }, quiet);
  const web = health.startSchedulerHeartbeat(redis, "adjustment", { enabled: false, intervalMs: 60000 }, quiet);
  await sleep(0);
  assert.equal((await health.getSchedulerHealth(redis, "adjustment")).scheduler_status, "running");
  assert.equal((await health.getSchedulerHealth(null, "adjustment")).scheduler_status, "unknown");
  worker.stop(); web.stop();
  process.env.SCHEDULER_STATUS_OWNER = "true";
  const off = health.startSchedulerHeartbeat(redis, "adjustment", { enabled: false, intervalMs: 60000 }, quiet);
  await sleep(0);
  assert.equal((await health.getSchedulerHealth(redis, "adjustment")).scheduler_status, "off");
  off.stop();
  if (previousOwner === undefined) delete process.env.SCHEDULER_STATUS_OWNER; else process.env.SCHEDULER_STATUS_OWNER = previousOwner;
  const row = { enabled: true, interval_ms: 60000, last_seen_at: new Date().toISOString(), state: "idle" };
  assert.equal(health.summarize(row, Date.now()+100000).scheduler_status, "stale");
  assert.equal(health.summarize({ ...row, state: "error" }).scheduler_status, "error");
  assert.equal(health.summarize({ ...row, state: "running", tick_started_at: new Date(Date.now()-200000).toISOString() }).scheduler_status, "stalled");
});

const url = process.env.CHAT_TEST_DATABASE_URL;
test("shared rebuild jobs and batched settlement on PostgreSQL", { skip: !url, timeout: 30000 }, async t => {
  const target = new URL(url);
  assert.ok(["127.0.0.1","localhost"].includes(target.hostname));
  assert.equal(target.username,"nasfaq_test");
  assert.equal(target.pathname,"/nasfaq_chat_test");
  const admin = new Pool({ connectionString: url });
  try { await admin.query("CREATE DATABASE nasfaq_ops_test"); } catch(e) { if(e.code!=="42P04") throw e; }
  await admin.end();
  target.pathname = "/nasfaq_ops_test";
  const pool = new Pool({ connectionString: target.href });
  const other = new Pool({ connectionString: target.href });
  let client;
  t.after(async () => { if (client) client.release(); await pool.end(); await other.end(); });
  await pool.query("CREATE SCHEMA IF NOT EXISTS market");
  await pool.query(jobs.schema);
  await pool.query("TRUNCATE market.rebuild_jobs");
  async function finished(id) {
    for(let i=0;i<200;i++) { const j=await jobs.getJob(other,id); if(j.status!=="running") return j; await sleep(10); }
    throw new Error("test job did not finish");
  }
  await t.test("progress and completion are visible from a different replica and job ID stays stable", async () => {
    let release; const gate=new Promise(r=>{release=r});
    const first=await jobs.startJob(pool,async progress=>{await progress({phase:"settling",done:1,total:2});await gate;return {ok:true};},quiet);
    for(let i=0;i<100;i++){ if((await jobs.getJob(other,first.id)).progress.done===1) break; await sleep(10); }
    assert.equal((await jobs.getJob(other,first.id)).progress.done,1);
    await assert.rejects(jobs.startJob(other,async()=>({}),quiet),e=>e.code==="rebuild_running" && e.job.id===first.id);
    release(); assert.equal((await finished(first.id)).status,"completed");
    const second=await jobs.startJob(other,async()=>({second:true}),quiet);await finished(second.id);
    assert.deepEqual((await jobs.getJob(pool,first.id)).result,{ok:true});
    const restarted=new Pool({connectionString:target.href});
    assert.equal((await jobs.getJob(restarted,second.id)).status,"completed");await restarted.end();
  });
  await t.test("failed work persists its error and releases the singleton lock", async()=>{
    const j=await jobs.startJob(pool,async()=>{throw Object.assign(new Error("failure"),{code:"fixture_failure"})},quiet);
    assert.equal((await finished(j.id)).error,"fixture_failure");
    const next=await jobs.startJob(other,async()=>({}),quiet); assert.equal((await finished(next.id)).status,"completed");
  });
  await t.test("a disconnected worker becomes interrupted, rather than an eternal running job", async()=>{
    const owner=new Client({connectionString:target.href});owner.on("error",()=>{});await owner.connect();
    const state=await owner.query("SELECT pg_backend_pid() AS pid,pg_advisory_lock($1)",[jobs.JOB_LOCK_KEY]);
    const id=randomUUID();await owner.query("INSERT INTO market.rebuild_jobs(id,owner_pid,job) VALUES($1,$2,$3)",
      [id,state.rows[0].pid,JSON.stringify({id,status:"running",progress:{phase:"settling",done:5,total:10}})]);
    assert.equal((await jobs.getJob(other,id)).status,"running");
    await other.query("SELECT pg_terminate_backend($1)",[state.rows[0].pid]);
    await owner.end();
    const j=await finished(id); assert.match(j.error,/rebuild_interrupted/);assert.equal(j.progress.done,5);
  });
  await t.test("starting a new job marks an orphan interrupted even when its backend PID is reused", async()=>{
    const reused=new Pool({connectionString:target.href,max:1});
    const owner=await reused.connect();
    const pid=(await owner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const id=randomUUID();
    await owner.query("INSERT INTO market.rebuild_jobs(id,owner_pid,job) VALUES($1,$2,$3)",
      [id,pid,JSON.stringify({id,status:"running",progress:{done:4}})]);
    owner.release();
    const next=await jobs.startJob(reused,async()=>({}),quiet);
    assert.equal((await jobs.getJob(other,id)).status,"failed");
    await finished(next.id);await reused.end();
  });
  await pool.query(`
    DROP TABLE IF EXISTS market.asset_price_events,market.asset_daily_market_state,market.market_assets CASCADE;
    CREATE TABLE market.market_assets(id bigint PRIMARY KEY,latest_snapshot_date date,latest_snapshot_id bigint,
      current_fair_value numeric,current_fair_value_raw numeric,current_mid_price numeric,current_bid_price numeric,
      current_ask_price numeric,current_premium_pct numeric,current_daily_emission numeric,current_persistent_offset numeric,
      current_transient_offset numeric,offsets_updated_at timestamptz,liquidity_depth numeric,
      circulating_supply numeric NOT NULL,treasury_supply numeric NOT NULL,max_supply numeric NOT NULL,updated_at timestamptz);
    CREATE TABLE market.asset_price_events(id bigserial PRIMARY KEY,asset_id bigint REFERENCES market.market_assets(id),
      ts timestamptz,event_type text,old_mid_price numeric,new_mid_price numeric,fair_value_at_event numeric,metadata_json jsonb);
    CREATE TABLE market.asset_daily_market_state(id bigserial PRIMARY KEY,asset_id bigint REFERENCES market.market_assets(id),
      market_date date,snapshot_id bigint,fair_value numeric,fair_value_raw numeric,mid_open numeric,mid_close numeric,
      mid_close_mark numeric,mid_high numeric,mid_low numeric,bid_close numeric,ask_close numeric,premium_close_pct numeric,
      daily_emission numeric,treasury_supply_start numeric,treasury_supply_end numeric,circulating_supply_start numeric,
      circulating_supply_end numeric,volume_shares numeric,volume_cash numeric,trade_count bigint,updated_at timestamptz,
      UNIQUE(asset_id,market_date));
    INSERT INTO market.market_assets(id,circulating_supply,treasury_supply,max_supply)
      SELECT id,1234.5678+id,10000,20000 FROM generate_series(1,73) id;
  `);
  const states=Array.from({length:73},(_,i)=>({assetId:i+1,snapshotId:i ? 200+i:null,snapshotDate:"2026-09-29",priorMidPrice:i ? 9.87654321:null,
    fairValue:11.23456789+i,fairValueRaw:i ? 10.001+i:null,midOpen:12.123+i,midClose:12.123+i,midCloseMark:11.888+i,
    midHigh:12.123+i,midLow:12.123+i,bidClose:12+i,askClose:12.5+i,premiumClosePct:0.1234,dailyEmission:0,
    treasurySupplyStart:10000,treasurySupplyEnd:10000,circulatingSupplyStart:1234.5678+i+1,circulatingSupplyEnd:1234.5678+i+1,
    volumeShares:0,volumeCash:0,tradeCount:0,persistentOffset:-0.4321,transientOffset:0.98765}));
  const date="2026-09-29";
  client=await pool.connect();
  async function snapshot(){
    const tables=["market_assets","asset_daily_market_state","asset_price_events"];
    const result={};for(const name of tables){result[name]=(await client.query(`SELECT to_jsonb(t)-'id'-'updated_at' AS row FROM market.${name} t ORDER BY ${name==="market_assets" ? "id":"asset_id"}`)).rows;}return result;
  }
  await t.test("bulk writes match all pre-change persisted values for 73 assets",async()=>{
    await client.query("BEGIN");await client.query("SET LOCAL TIME ZONE 'America/New_York'");
    for(const state of states) await legacy.persistSettledAssetState(client,date,state);
    const expected=await snapshot();await client.query("ROLLBACK");
    await client.query("BEGIN");await client.query("SET LOCAL TIME ZONE 'America/New_York'");
    let calls=0;const counted={query(...args){calls++;return client.query(...args)}};
    await batch.persistStates(counted,date,states,2000);
    assert.equal(calls,4);assert.deepEqual(await snapshot(),expected);
    assert.equal(Number((await client.query("SELECT circulating_supply FROM market.market_assets WHERE id=1")).rows[0].circulating_supply),1235.5678);
    await client.query("COMMIT");
  });
  await t.test("prior-state bulk reads keep two correct dates per asset and ignore future rows",async()=>{
    await client.query("INSERT INTO market.asset_daily_market_state(asset_id,market_date,mid_close) VALUES(1,'2026-09-27',1),(1,'2026-09-28',2),(1,'2026-09-30',4),(2,'2026-09-28',5)");
    let calls=0;
    const map=await batch.loadPreviousStates({query(...args){calls++;return client.query(...args)}},[1,2,73],"2026-09-30");
    assert.equal(calls,1);
    assert.deepEqual(map.get(1).map(x=>String(x.mid_close)),[String(states[0].midClose),"2"]);
    assert.equal(map.get(2).length,2);assert.equal(map.get(73).length,1);
  });
  await t.test("failed bulk persistence rolls back all writes and assets",async()=>{
    const before=await snapshot();await client.query("BEGIN");
    await assert.rejects(batch.persistStates(client,date,states,2000),e=>e.code==="23505");
    await client.query("ROLLBACK");assert.deepEqual(await snapshot(),before);
  });
  await t.test("empty batches do not issue writes",async()=>{await batch.persistStates({query(){throw Error("unexpected")}},date,[],2000)});
});

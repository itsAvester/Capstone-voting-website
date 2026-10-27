#!/usr/bin/env node
/**
 * Import the precise files produced by prepare_search_arena_reviews.py.
 * Usage: npm run import:batch -- --dir ./data/review_batch
 * Requires configured .env.local and schema already applied.
 * Safe to re-run after partial uploads; never overwrites existing rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadDotEnv(filename){
  if(!fs.existsSync(filename))return;
  for(const line of fs.readFileSync(filename,'utf8').split(/\r?\n/)){
    const trimmed=line.trim(); if(!trimmed||trimmed.startsWith('#'))continue;
    const match=trimmed.match(/^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/);
    if(!match)continue;
    let val=match[2].trim();
    if((val.startsWith('"')&&val.endsWith('"'))||(val.startsWith("'")&&val.endsWith("'")))val=val.slice(1,-1);
    if(!(match[1] in process.env))process.env[match[1]]=val;
  }
}
loadDotEnv(path.join(process.cwd(),'.env.local'));
const checkOnly=process.argv.includes('--check-only');
const argIndex=process.argv.indexOf('--dir');
const dir=path.resolve(argIndex>=0?process.argv[argIndex+1]:'data/review_batch');
const itemsPath=path.join(dir,'review_items.json');
const assignmentsPath=path.join(dir,'initial_assignments.csv');
const manifestPath=path.join(dir,'sampling_manifest.json');
if(!fs.existsSync(itemsPath)||!fs.existsSync(assignmentsPath)||!fs.existsSync(manifestPath)){
  throw new Error(`Missing files in ${dir}: need review_items.json, initial_assignments.csv and sampling_manifest.json from ENGLISH-ONLY sampler`);
}
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(manifest.english_only !== true || manifest.only_missing_preference !== true ||
  manifest.response_language_check !== 'langdetect' || manifest.selected_observations !== 500){
  throw new Error('Wrong sampling manifest: this website requires 500 English-only observations WITHOUT original votes. Rerun prepare_search_arena_reviews_english.py.');
}

const items=JSON.parse(fs.readFileSync(itemsPath,'utf8'));
const lines=fs.readFileSync(assignmentsPath,'utf8').trim().split(/\r?\n/);
const header=lines.shift().split(',').map(s=>s.trim());
const expected=['observation_id','reviewer_id','stage','left_response','right_response'];
if(expected.join(',')!==header.join(','))throw new Error(`Unexpected CSV columns: ${header.join(',')}`);
const assignments=lines.map(line=>{
  const fields=line.split(',').map(s=>s.trim());
  return Object.fromEntries(header.map((col,index)=>[col,fields[index]]));
});
const ids=new Set(items.map(x=>x.id));
const sourceIds=new Set(items.map(x=>x.source_row_id));
const uniqueAssignments=new Set(assignments.map(x=>`${x.observation_id}#${x.reviewer_id}`));
if(items.length!==500||ids.size!==500||sourceIds.size!==500)throw new Error('Expected 500 distinct observations, IDs and source rows.');
if(assignments.length!==1000||uniqueAssignments.size!==1000)throw new Error('Expected 1000 distinct assignments.');
const reviewerCount=Object.fromEntries(Array.from({length:5},(_,i)=>[`reviewer_${i+1}`,0]));
const pairCounts=new Map();
function englishTagsOnly(raw){
  let values=raw;
  if(typeof values==='string') {
    try { values=JSON.parse(values); } catch { values=[values]; }
  }
  if(!Array.isArray(values)||values.length===0) return false;
  return values.every(x=> typeof x==='string' && /^(en([_-][a-z0-9]+)*|eng|english)$/i.test(x.trim()));
}
for(const item of items){
  if(!item.prompt||!item.response_a||!item.response_b||!Array.isArray(item.conversation_a)||!Array.isArray(item.conversation_b)||!englishTagsOnly(item.languages))
    throw new Error(`Invalid text, conversation, or non-English language tag in ${item.id}`);
}
for(const assignment of assignments){
  if(!ids.has(assignment.observation_id)||!(assignment.reviewer_id in reviewerCount)||
    assignment.stage!=='initial'||!['a','b'].includes(assignment.left_response)||
    !['a','b'].includes(assignment.right_response)||assignment.left_response===assignment.right_response)
    throw new Error(`Bad assignment: ${JSON.stringify(assignment)}`);
  reviewerCount[assignment.reviewer_id]++;
  pairCounts.set(assignment.observation_id,(pairCounts.get(assignment.observation_id)||[]).concat(assignment.reviewer_id));
}
if(Object.values(reviewerCount).some(n=>n!==200)||[...pairCounts.values()].some(arr=>arr.length!==2))
  throw new Error('Reviewer assignments are not balanced at 200 each / 2 per observation.');
const pairTotals=new Map();
for(const arr of pairCounts.values()){
  const key=[...arr].sort().join('+');pairTotals.set(key,(pairTotals.get(key)||0)+1);
}
if(pairTotals.size!==10||[...pairTotals.values()].some(x=>x!==50))
  throw new Error('Each of ten reviewer pairs must have exactly 50 shared observations.');

if(checkOnly){
  console.log('VALID ENGLISH-ONLY UNVOTED SAMPLE: 500 observations, 1000 assignments, 200/reviewer, 50/reviewer pair. No database connection made.');
  process.exit(0);
}
if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Configure .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false}
});
// Supabase may commit a batch even if the network connection fails before the
// client receives the response. Use insert-on-conflict-DO-NOTHING semantics so
// retries cannot overwrite submitted data or duplicate observations.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const describeError = error => {
  if (!error) return 'Unknown error';
  const message = error.message || String(error);
  const details = error.details ? ` | ${error.details}` : '';
  const cause = error.cause?.message ? ` | Cause: ${error.cause.message}` : '';
  return `${message}${details}${cause}`.slice(0, 650);
};

async function attempt(label, fn, maxAttempts = 3){
  let lastError;
  for(let tryNum = 1; tryNum <= maxAttempts; tryNum++){
    try {
      const result = await fn();
      if(!result.error) return result;
      lastError = result.error;
    } catch(error) {
      lastError = error;
    }
    console.warn(`\n${label}: attempt ${tryNum}/${maxAttempts} failed: ${describeError(lastError)}`);
    if(tryNum < maxAttempts) await sleep(600 * Math.pow(2, tryNum - 1));
  }
  return {error:lastError};
}

// Read all existing identifiers, not only the first 1,000 rows. This prevents
// accidental mixing of batches and enables a safe resume after interruptions.
async function readExisting(table, columns, orderColumns){
  const all=[];
  const PAGE=400;
  for(let start=0;;start+=PAGE){
    const {data,error}=await attempt(`Read existing ${table} rows ${start}-${start+PAGE-1}`,()=>{
      let query=db.from(table).select(columns);
      for(const field of orderColumns) query=query.order(field,{ascending:true});
      return query.range(start,start+PAGE-1);
    });
    if(error) throw new Error(`Could not check existing ${table}: ${describeError(error)}`);
    all.push(...data);
    if(data.length<PAGE) return all;
  }
}

const observations=items.map(x=>({
  id:x.id,source_row_id:x.source_row_id,primary_intent:x.primary_intent||'Unknown',
  languages:x.languages||null,prompt:x.prompt,response_a:x.response_a,response_b:x.response_b,
  conversation_a:x.conversation_a,conversation_b:x.conversation_b
}));

// Block uploads if somebody has already begun voting. Resuming the initial data
// import should happen *before* team members are given access to the website.
const voteCheck=await attempt('Check whether voting has started',()=>
  db.from('votes').select('*',{count:'exact',head:true}));
if(voteCheck.error) throw new Error(`Cannot check existing votes: ${describeError(voteCheck.error)}`);
if(voteCheck.count>0) throw new Error('Votes already exist. Import stopped to avoid changing an active study. Do not delete votes.');

const priorObservations=await readExisting('observations','id,source_row_id',['id']);
const expectedObs=new Map(observations.map(x=>[x.id,x]));
for(const old of priorObservations){
  const expected=expectedObs.get(old.id);
  if(!expected || expected.source_row_id!==old.source_row_id)
    throw new Error(`Existing observation ${old.id} does not match this batch (source row ${old.source_row_id}). Refusing to mix datasets.`);
}
const priorAssignments=await readExisting('assignments',
  'observation_id,reviewer_id,stage,left_response,right_response,state',
  ['observation_id','reviewer_id']);
const assignmentKey=x=>`${x.observation_id}#${x.reviewer_id}`;
const expectedAssignments=new Map(assignments.map(x=>[assignmentKey(x),x]));
for(const old of priorAssignments){
  const expected=expectedAssignments.get(assignmentKey(old));
  if(!expected || old.stage!=='initial' || old.state!=='pending' ||
    old.left_response!==expected.left_response || old.right_response!==expected.right_response)
    throw new Error(`Existing assignment ${assignmentKey(old)} doesn't match this batch. Refusing to overwrite or mix assignments.`);
}

console.log(`Existing database: ${priorObservations.length}/500 observations, ${priorAssignments.length}/1000 assignments.`);
const priorObsIds=new Set(priorObservations.map(x=>x.id));
const priorAssignmentKeys=new Set(priorAssignments.map(assignmentKey));
const missingObservations=observations.filter(x=>!priorObsIds.has(x.id));
const missingAssignments=assignments.filter(x=>!priorAssignmentKeys.has(assignmentKey(x)));

// Smaller requests avoid giant response-body uploads. When one batch repeatedly
// fails, split it in half until the single problematic row is identified.
async function sendRows(table, rows, conflictColumn, getLabel){
  let uploaded=0;
  async function sendChunk(chunk){
    const label=`Upload ${table} (${getLabel(chunk[0])}..${getLabel(chunk[chunk.length-1])}; ${chunk.length} rows)`;
    const {error}=await attempt(label,()=>db.from(table).upsert(chunk,{
      onConflict:conflictColumn,ignoreDuplicates:true
    }));
    if(!error){
      uploaded+=chunk.length;
      process.stdout.write(`\r${table}: ${uploaded}/${rows.length} missing rows uploaded`);
      return;
    }
    if(chunk.length===1){
      const bytes=Buffer.byteLength(JSON.stringify(chunk[0]));
      throw new Error(`Repeated failure at ${getLabel(chunk[0])} (${bytes} bytes). ${describeError(error)}. `+
        'Check your Supabase project status/network, or inspect this unusually large observation. Previous uploads remain saved.');
    }
    console.warn(`\nSplitting the failed ${table} batch into smaller requests...`);
    const middle=Math.floor(chunk.length/2);
    await sendChunk(chunk.slice(0,middle));
    await sendChunk(chunk.slice(middle));
  }
  const BATCH=15;
  for(let start=0;start<rows.length;start+=BATCH) await sendChunk(rows.slice(start,start+BATCH));
  if(rows.length) console.log();
}

// Always upload missing observations before assignments (which reference them).
await sendRows('observations',missingObservations,'id',x=>x.id);
await sendRows('assignments',missingAssignments,'observation_id,reviewer_id',assignmentKey);

// Validate database completeness after resumed uploads.
const finishedObservations=await readExisting('observations','id,source_row_id',['id']);
const finishedAssignments=await readExisting('assignments',
  'observation_id,reviewer_id,stage,left_response,right_response,state',
  ['observation_id','reviewer_id']);
if(finishedObservations.length!==500 || finishedAssignments.length!==1000)
  throw new Error(`Upload did not finish: ${finishedObservations.length}/500 observations, `+
    `${finishedAssignments.length}/1000 assignments. Run the same import command again to resume.`);
console.log('Done: 500 observations, 1000 assignments, five reviewers.');
console.log('Your private_model_lookup.json was NOT uploaded. Preserve it privately for analysis.');

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { currentReviewer } from '@/lib/session';
import { adminDb } from '@/lib/supabase-admin';
import { failed,originIsAllowed } from '@/lib/http';
export const runtime='nodejs';
function safeCompare(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
function quoteCsv(v:unknown):string{
  const text=v==null?'':typeof v==='string'?v:JSON.stringify(v);
  return `"${text.replaceAll('"','""')}"`;
}
function csv(rows:Record<string,unknown>[],columns:string[]):string{
  return [columns.map(quoteCsv).join(','),...rows.map(r=>columns.map(c=>quoteCsv(r[c])).join(','))].join('\r\n')+'\r\n';
}
async function allRows(table:'observations'|'votes'|'assignments') {
  const db=adminDb();
  const results:Record<string,unknown>[]=[];
  for(let from=0; from<10000;from+=500){
    const {data,error}=await db.from(table).select('*').range(from,from+499);
    if(error) throw error;
    results.push(...(data??[]) as Record<string,unknown>[]);
    if(!data||data.length<500)break;
  }
  return results;
}
export async function POST(req:NextRequest){
  if(!originIsAllowed(req))return failed('Invalid origin.',403);
  if(!await currentReviewer())return failed('Please sign in.',401);
  let body:{pin?:unknown;type?:unknown};
  try{body=await req.json();}catch{return failed('Invalid JSON.');}
  const expected=process.env.ADMIN_EXPORT_PIN;
  if(typeof body.pin!=='string'||!expected||expected.length<8||expected.startsWith('CHANGE_TO_')||!safeCompare(expected,body.pin))
    return failed('Invalid export password.',403);
  if(!['summary','votes'].includes(String(body.type)))return failed('Invalid export type.');
  try{
    let content:string, filename:string;
    if(body.type==='votes'){
      const votes=await allRows('votes');
      content=csv(votes,['observation_id','reviewer_id','choice','created_at']);
      filename='search_arena_individual_votes.csv';
    }else{
      const [observations,votes]=await Promise.all([allRows('observations'),allRows('votes')]);
      const byId=new Map<string,Record<string,unknown>[]>();
      for(const vote of votes){const id=String(vote.observation_id);byId.set(id,[...(byId.get(id)||[]),vote]);}
      const rows=observations.map(o=>{
        const v=byId.get(String(o.id))||[];
        return {id:o.id,source_row_id:o.source_row_id,primary_intent:o.primary_intent,
          status:o.status,consensus:o.consensus,vote_count:v.filter(x=>x.choice!=='skip').length,
          abstentions:v.filter(x=>x.choice==='skip').length,
          vote_a:v.filter(x=>x.choice==='a').length,
          vote_b:v.filter(x=>x.choice==='b').length,
          vote_tie:v.filter(x=>x.choice==='tie').length,
          vote_both_bad:v.filter(x=>x.choice==='both_bad').length,
          reviewer_votes:JSON.stringify(v.map(x=>({reviewer_id:x.reviewer_id,choice:x.choice}))),
          finalized_at:o.finalized_at};
      });
      content=csv(rows,['id','source_row_id','primary_intent','status','consensus','vote_count','abstentions','vote_a','vote_b','vote_tie','vote_both_bad','reviewer_votes','finalized_at']);
      filename='search_arena_consensus.csv';
    }
    return new NextResponse(content,{headers:{
      'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="${filename}"`,
      'Cache-Control':'no-store'
    }});
  }catch(e){console.error(e);return failed('Export failed.',503);}
}

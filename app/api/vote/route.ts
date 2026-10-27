import { NextRequest, NextResponse } from 'next/server';
import { currentReviewer } from '@/lib/session';
import { adminDb } from '@/lib/supabase-admin';
import { failed, noStore, originIsAllowed } from '@/lib/http';
export const runtime='nodejs';
const VALID_TAGS=new Set([
  'refused_punted','no_citations','broken_citations','unsupported_claim','factual_error',
  'incomplete','off_topic','too_vague','too_verbose','poor_formatting','better_sourcing',
  'more_useful','missing_context'
]);
type SubmittedTag={code:string;appliesTo:'left'|'right'|'both'};
export async function POST(req: NextRequest) {
  if (!originIsAllowed(req)) return failed('Invalid origin.',403);
  const reviewerId=await currentReviewer();
  if (!reviewerId) return failed('Please sign in.',401);
  let body:{observationId?:unknown;choice?:unknown;reasonTags?:unknown;reasonKeywords?:unknown;reasonKeywordsTarget?:unknown};
  try {body=await req.json();} catch{return failed('Invalid JSON.');}
  const observationId=body.observationId;
  const choice=body.choice;
  if(typeof observationId!=='string'||observationId.length>100||
     typeof choice!=='string'||!['left','right','tie','both_bad','skip'].includes(choice))
    return failed('Invalid observation or vote.');
  const tags=body.reasonTags??[];
  if(!Array.isArray(tags)||tags.length>8||!tags.every((tag:unknown)=>
    tag!==null&&typeof tag==='object'&&
    VALID_TAGS.has((tag as SubmittedTag).code)&&
    ['left','right','both'].includes((tag as SubmittedTag).appliesTo)))
    return failed('Invalid reason tags.');
  if(body.reasonKeywordsTarget!==undefined&&!['left','right','both'].includes(String(body.reasonKeywordsTarget)))
    return failed('Invalid keyword attribution.');
  if(body.reasonKeywords!==undefined&&(typeof body.reasonKeywords!=='string'||body.reasonKeywords.length>160))
    return failed('Reason keywords must be 160 characters or fewer.');
  try {
    const db=adminDb();
    const {data:assignment,error:assignmentError}=await db.from('assignments')
      .select('left_response,right_response,state').eq('observation_id',observationId)
      .eq('reviewer_id',reviewerId).single();
    if(assignmentError||!assignment||assignment.state!=='pending') return failed('This item is not awaiting your vote.',409);
    const canonical=choice==='left'?assignment.left_response:choice==='right'?assignment.right_response:choice;
    const canonicalTags=(tags as SubmittedTag[]).map(t=>({
      code:t.code,
      applies_to:t.appliesTo==='both'?'both':t.appliesTo==='left'?assignment.left_response:assignment.right_response
    }));
    // Attribution uses the canonical model side, not the randomized display side.
    const {data,error}=await db.rpc('submit_review_vote',{
      p_observation_id:observationId,p_reviewer_id:reviewerId,p_choice:canonical,
      p_reason_tags:canonicalTags,p_reason_keywords:(body.reasonKeywords as string||'').trim(),
      p_reason_keywords_target:body.reasonKeywordsTarget==='left'?assignment.left_response:body.reasonKeywordsTarget==='right'?assignment.right_response:'both'
    });
    if(error){console.error(error);return failed('Vote not saved: assignment may already be closed. Refresh the page.',409);}
    // No other reviewers' votes are returned to maintain independent judgment.
    return NextResponse.json({ saved:true, status:data?.status },{headers:noStore});
  }catch(e){console.error(e);return failed('Could not save vote.',503);}
}

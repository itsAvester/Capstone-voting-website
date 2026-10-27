import { NextRequest, NextResponse } from 'next/server';
import { currentReviewer } from '@/lib/session';
import { adminDb } from '@/lib/supabase-admin';
import { failed, noStore, originIsAllowed } from '@/lib/http';
export const runtime='nodejs';
export async function POST(req: NextRequest) {
  if (!originIsAllowed(req)) return failed('Invalid origin.',403);
  const reviewerId=await currentReviewer();
  if (!reviewerId) return failed('Please sign in.',401);
  let body:{observationId?:unknown;choice?:unknown};
  try {body=await req.json();} catch{return failed('Invalid JSON.');}
  const observationId=body.observationId;
  const choice=body.choice;
  if(typeof observationId!=='string'||observationId.length>100||
     typeof choice!=='string'||!['left','right','tie','both_bad','skip'].includes(choice))
    return failed('Invalid observation or vote.');
  try {
    const db=adminDb();
    const {data:assignment,error:assignmentError}=await db.from('assignments')
      .select('left_response,right_response,state').eq('observation_id',observationId)
      .eq('reviewer_id',reviewerId).single();
    if(assignmentError||!assignment||assignment.state!=='pending') return failed('This item is not awaiting your vote.',409);
    const canonical=choice==='left'?assignment.left_response:choice==='right'?assignment.right_response:choice;
    const {data,error}=await db.rpc('submit_review_vote',{
      p_observation_id:observationId,p_reviewer_id:reviewerId,p_choice:canonical
    });
    if(error){console.error(error);return failed('Vote not saved: assignment may already be closed. Refresh the page.',409);}
    // No other reviewers' votes are returned to maintain independent judgment.
    return NextResponse.json({ saved:true, status:data?.status },{headers:noStore});
  }catch(e){console.error(e);return failed('Could not save vote.',503);}
}

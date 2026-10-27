import { NextResponse } from 'next/server';
import { currentReviewer } from '@/lib/session';
import { adminDb } from '@/lib/supabase-admin';
import { failed, noStore } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET() {
  const reviewerId = await currentReviewer();
  if (!reviewerId) return failed('Please sign in.',401);
  try {
    const db = adminDb();
    // Count may include assignments completed after an observation was resolved;
    // pending assignments are filtered to OPEN observations below.
    const [all, complete, pending, closed, reviewer] = await Promise.all([
      db.from('assignments').select('*',{count:'exact',head:true}).eq('reviewer_id',reviewerId),
      db.from('assignments').select('*',{count:'exact',head:true}).eq('reviewer_id',reviewerId).eq('state','completed'),
      db.from('assignments').select('observation_id,left_response,right_response,stage,observations!inner(id,prompt,response_a,response_b,conversation_a,conversation_b,primary_intent,status)')
        .eq('reviewer_id',reviewerId).eq('state','pending').eq('observations.status','open')
        .order('created_at',{ascending:true}).limit(1),
      db.from('observations').select('*',{count:'exact',head:true}).in('status',['finalized','unresolved']),
      db.from('reviewers').select('id,display_name').eq('id',reviewerId).single()
    ]);
    for (const x of [all,complete,pending,closed,reviewer]) if (x.error) throw x.error;
    const assignment = pending.data?.[0];
    const observation = assignment?.observations as unknown as {
      id:string;prompt:string;response_a:string;response_b:string;
      conversation_a:{role:string;content:string}[];
      conversation_b:{role:string;content:string}[];
      primary_intent:string;
    } | undefined;
    const item = assignment && observation ? {
      id: observation.id,
      prompt: observation.prompt,
      primary_intent: observation.primary_intent,
      stage: assignment.stage,
      left: assignment.left_response === 'a' ? observation.response_a : observation.response_b,
      right: assignment.right_response === 'a' ? observation.response_a : observation.response_b,
      leftConversation: assignment.left_response === 'a' ? observation.conversation_a : observation.conversation_b,
      rightConversation: assignment.right_response === 'a' ? observation.conversation_a : observation.conversation_b,
    } : null;
    return NextResponse.json({ reviewer: reviewer.data, item,
      stats: { assigned: all.count||0, completed: complete.count||0, closed: closed.count||0, target: 500 }
    },{headers:noStore});
  } catch(e) {console.error(e);return failed('Could not load your next observation.',503);}
}

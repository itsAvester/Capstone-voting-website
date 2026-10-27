import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { setReviewerCookie, safePinCompare } from '@/lib/session';
import { originIsAllowed, failed, noStore } from '@/lib/http';
import { adminDb } from '@/lib/supabase-admin';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  if (!originIsAllowed(req)) return failed('Invalid origin.',403);
  let body: { reviewerId?:unknown; pin?:unknown };
  try { body = await req.json(); } catch { return failed('Invalid JSON.'); }
  const id = body.reviewerId;
  const pin = body.pin;
  if (typeof id !== 'string' || !/^reviewer_[1-5]$/.test(id) || typeof pin !== 'string' || !/^\d{4}$/.test(pin))
    return failed('Select your reviewer name and enter your PIN.');
  // Rate-limit 4-digit PIN guessing. Run sql/02_login_rate_limit.sql first.
  const ip = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = createHmac('sha256', process.env.APP_SESSION_SECRET || 'missing-app-session-secret')
    .update(`${id}:${ip}`).digest('hex');
  try {
    const { data: permitted, error: throttleError } = await adminDb().rpc('claim_login_attempt', {p_key:key});
    if (throttleError) { console.error('Login rate-limit setup:', throttleError); return failed('Login setup incomplete. Run sql/02_login_rate_limit.sql.',503); }
    if (!permitted) return failed('Too many attempts. Try again in 15 minutes.',429);
  } catch (err) { console.error(err); return failed('Login temporarily unavailable.',503); }
  const expected = process.env[id.toUpperCase() + '_PIN'];
  if (!safePinCompare(expected, pin)) return failed('Incorrect reviewer or PIN.',401);
  // Clearing failures on success allows each reviewer to log back in normally.
  try { await adminDb().rpc('clear_login_attempts', {p_key:key}); }
  catch(err) { console.warn('Could not clear login attempts',err); }
  try {
    const { data, error } = await adminDb().from('reviewers').select('id').eq('id',id).single();
    if (error || !data) return failed('Reviewer not found. Run the schema setup.',503);
    const res = NextResponse.json({ ok: true },{headers: noStore});
    setReviewerCookie(res,id);
    return res;
  } catch(e) { console.error(e); return failed('Login is unavailable.',503); }
}

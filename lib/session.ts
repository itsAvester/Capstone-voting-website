import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

const NAME = 'arena_review_session';
const WEEK = 7 * 24 * 60 * 60;
const VALID_REVIEWERS = new Set(['reviewer_1','reviewer_2','reviewer_3','reviewer_4','reviewer_5']);

function secret(): string {
  const value = process.env.APP_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('APP_SESSION_SECRET must be at least 32 characters');
  return value;
}
function signature(text: string): string {
  return createHmac('sha256', secret()).update(text).digest('base64url');
}
function safeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  return aBytes.length === bBytes.length && timingSafeEqual(aBytes, bBytes);
}
export function safePinCompare(expected: string | undefined, entered: string): boolean {
  if (!expected || expected.startsWith('CHANGE_TO_') || !/^\d{4}$/.test(expected) || !/^\d{4}$/.test(entered)) return false;
  return safeEqual(expected, entered);
}

export function setReviewerCookie(res: NextResponse, reviewerId: string) {
  if (!VALID_REVIEWERS.has(reviewerId)) throw new Error('Invalid reviewer ID');
  const body = Buffer.from(JSON.stringify({ id: reviewerId, exp: Math.floor(Date.now()/1000)+WEEK })).toString('base64url');
  res.cookies.set(NAME, `${body}.${signature(body)}`, {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    maxAge: WEEK, path: '/'
  });
}

export function clearReviewerCookie(res: NextResponse) {
  res.cookies.set(NAME, '', { maxAge: 0, path: '/' });
}

export async function currentReviewer(): Promise<string | null> {
  try {
    const cookie = (await cookies()).get(NAME)?.value;
    if (!cookie) return null;
    const [body, sig] = cookie.split('.');
    if (!body || !sig || !safeEqual(sig, signature(body))) return null;
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const data = parsed as {id?:unknown; exp?:unknown};
    if (typeof data.id !== 'string' || !VALID_REVIEWERS.has(data.id)) return null;
    if (typeof data.exp !== 'number' || data.exp <= Math.floor(Date.now()/1000)) return null;
    return data.id;
  } catch { return null; }
}

import { NextRequest, NextResponse } from 'next/server';
import { clearReviewerCookie } from '@/lib/session';
import { failed, noStore, originIsAllowed } from '@/lib/http';
export async function POST(req: NextRequest) {
  if (!originIsAllowed(req)) return failed('Invalid origin.',403);
  const res = NextResponse.json({ok: true}, {headers: noStore});
  clearReviewerCookie(res);
  return res;
}

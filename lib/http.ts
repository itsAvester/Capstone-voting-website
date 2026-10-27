import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
export const noStore = { 'Cache-Control': 'no-store' };
export function failed(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: noStore });
}
export function originIsAllowed(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  // Scripted clients may omit Origin; browsers making cross-origin requests include it.
  if (!origin) return true;
  return origin === req.nextUrl.origin;
}

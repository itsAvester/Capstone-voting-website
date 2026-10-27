import { adminDb } from '@/lib/supabase-admin';
import { failed, noStore } from '@/lib/http';
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const { data, error } = await adminDb().from('reviewers').select('id,display_name').order('id');
    if (error) throw error;
    return NextResponse.json({ reviewers: data }, { headers: noStore });
  } catch (e) { console.error(e); return failed('Could not load reviewers. Check the Supabase setup.', 503); }
}

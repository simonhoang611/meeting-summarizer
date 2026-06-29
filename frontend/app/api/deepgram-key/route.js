import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ key: process.env.DEEPGRAM_API_KEY });
}

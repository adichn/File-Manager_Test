// src/app/api/process-file/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { orchestrateFileIngestion } from '@/lib/ai/orchestrator'

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-ingest-secret')
    
    if (!secret || secret !== process.env.INGEST_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { fileId, userId } = await request.json()

    if (!fileId || typeof fileId !== 'string' || !userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'fileId and userId are required and must be strings' },
        { status: 400 }
      )
    }

    await orchestrateFileIngestion({ fileId, userId })

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Process file error:', error)
    return NextResponse.json(
      { status: 'error', message: 'Failed to process file' },
      { status: 500 }
    )
  }
}
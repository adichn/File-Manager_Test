// src/app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { orchestrateFileIngestion } from '@/lib/ai/orchestrator'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json(
        { error: 'File is required' },
        { status: 400 }
      )
    }

    const userId = user.id
    const fileId = crypto.randomUUID()
    const storagePath = `${userId}/${fileId}/${file.name}`

    const fileBuffer = await file.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from('files')
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
      })

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      )
    }

    const { data: insertedFile, error: insertError } = await supabase
      .from('files')
      .insert({
        id: fileId,
        user_id: userId,
        storage_path: storagePath,
        original_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    // Trigger orchestrator in background (non-blocking)
    void orchestrateFileIngestion({
      fileId: insertedFile.id,
      userId: insertedFile.user_id,
    }).catch((err) => console.error('Failed to orchestrate ingestion:', err))

    // Optional: Notify n8n webhook if configured
    if (process.env.N8N_INGEST_WEBHOOK_URL) {
      fetch(process.env.N8N_INGEST_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ingest-secret': process.env.INGEST_SECRET ?? '',
        },
        body: JSON.stringify({
          fileId: insertedFile.id,
          userId: insertedFile.user_id,
        }),
      }).catch((err) => console.error('Failed to notify n8n:', err))
    }

    return NextResponse.json({ file: insertedFile })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
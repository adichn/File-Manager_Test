// src/app/api/upload/route.ts

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { orchestrateFileIngestion } from '@/lib/ai/orchestrator';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Auth error:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folderId = (formData.get('folderId') as string) || null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fileId = crypto.randomUUID();
    const folderPart = folderId || 'root';
    const storagePath = `${user.id}/${folderPart}/${fileId}/${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from('files')
      .upload(storagePath, file);

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: fileRecord, error: insertError } = await supabase
      .from('files')
      .insert({
        id: fileId,
        user_id: user.id,
        original_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        storage_path: storagePath,
        folder_id: folderId
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      await supabase.storage.from('files').remove([storagePath]);
      return NextResponse.json({ error: `Failed to create file record: ${insertError.message}` }, { status: 500 });
    }

    orchestrateFileIngestion({ fileId, userId: user.id }).catch((err) => {
      console.error('Orchestration failed:', err);
    });

    return NextResponse.json({ file: fileRecord });
  } catch (err) {
    console.error('Upload route error:', err);
    return NextResponse.json({ 
      error: `Server error: ${err instanceof Error ? err.message : String(err)}` 
    }, { status: 500 });
  }
}
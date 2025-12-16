// src/app/api/search/route.ts

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

interface FileRecord {
  id: string;
  original_name: string;
  mime_type: string;
  created_at: string;
  folder_id: string | null;
  file_metadata: FileMetadata[] | FileMetadata | null;
}

interface FileMetadata {
  summary: string | null;
  tags: string[];
  extra: Record<string, unknown> | null;
}

export async function GET(request: NextRequest) {
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';
  const folderId = searchParams.get('folderId');

  let filesQuery = supabase
    .from('files')
    .select('id, original_name, mime_type, created_at, folder_id, file_metadata(summary, tags, extra)')
    .eq('user_id', user.id);

  if (folderId) {
    if (folderId === 'root') {
      filesQuery = filesQuery.is('folder_id', null);
    } else {
      filesQuery = filesQuery.eq('folder_id', folderId);
    }
  }

  filesQuery = filesQuery.order('created_at', { ascending: false }).limit(100);

  const { data: files, error: fetchError } = await filesQuery;

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }

  let results = (files || []).map((file: FileRecord) => {
    const metadata = Array.isArray(file.file_metadata) 
      ? file.file_metadata[0] 
      : file.file_metadata;

    return {
      file_id: file.id,
      original_name: file.original_name,
      mime_type: file.mime_type,
      created_at: file.created_at,
      folder_id: file.folder_id,
      summary: metadata?.summary || null,
      tags: metadata?.tags || [],
      extra: metadata?.extra || null
    };
  });

  if (query.length >= 2) {
    const qLower = query.toLowerCase();
    results = results.filter((result) => {
      const nameMatch = result.original_name?.toLowerCase().includes(qLower);
      const summaryMatch = result.summary?.toLowerCase().includes(qLower);
      const tagsMatch = result.tags.some((tag: string) => 
        tag.toLowerCase().includes(qLower)
      );
      return nameMatch || summaryMatch || tagsMatch;
    });
  }

  results = results.slice(0, 25);

  return NextResponse.json({
    query,
    results
  });
}
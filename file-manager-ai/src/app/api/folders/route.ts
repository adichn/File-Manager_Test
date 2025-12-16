// src/app/api/folders/route.ts

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

interface FolderRecord {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  folder_metadata: FolderMetadata[] | FolderMetadata | null;
}

interface FolderMetadata {
  summary: string | null;
  tags: string[];
  extra: Record<string, unknown> | null;
}

export async function GET() {
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

  const { data: folders, error: fetchError } = await supabase
    .from('folders')
    .select('id, name, parent_id, created_at, folder_metadata(summary, tags, extra)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch folders' }, { status: 500 });
  }

  const result = (folders || []).map((folder: FolderRecord) => {
    const metadata = Array.isArray(folder.folder_metadata)
      ? folder.folder_metadata[0]
      : folder.folder_metadata;

    return {
      id: folder.id,
      name: folder.name,
      parent_id: folder.parent_id,
      created_at: folder.created_at,
      metadata: metadata ? {
        summary: metadata.summary,
        tags: metadata.tags,
        extra: metadata.extra
      } : null
    };
  });

  return NextResponse.json({ folders: result });
}

export async function POST(request: NextRequest) {
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

  const body = await request.json();
  const name = body.name?.trim();
  const parentId = body.parentId || null;

  if (!name || name.length < 1 || name.length > 80) {
    return NextResponse.json({ error: 'Invalid folder name' }, { status: 400 });
  }

  const { data: folder, error: insertError } = await supabase
    .from('folders')
    .insert({
      user_id: user.id,
      name,
      parent_id: parentId
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 });
  }

  return NextResponse.json({ folder });
}
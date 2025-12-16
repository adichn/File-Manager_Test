// src/app/api/folders/[id]/context/route.ts

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface FileWithMetadata {
  id: string;
  original_name: string;
  mime_type: string;
  file_metadata: Array<{
    summary: string | null;
    tags: string[];
    extra: Record<string, unknown> | null;
  }> | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: folderId } = await params;
  
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

  const { data: folder, error: folderError } = await supabase
    .from('folders')
    .select('*')
    .eq('id', folderId)
    .eq('user_id', user.id)
    .single();

  if (folderError || !folder) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  const { data: files, error: filesError } = await supabase
    .from('files')
    .select('id, original_name, mime_type, file_metadata(summary, tags, extra)')
    .eq('user_id', user.id)
    .eq('folder_id', folderId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (filesError) {
    return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
  }

  const fileList = (files || []) as FileWithMetadata[];
  
  let summary: string;
  let tags: string[];
  let extraContext: Record<string, unknown>;

  const fileCount = fileList.length;
  let textFileCount = 0;
  let pendingExtractionCount = 0;

  const fileDescriptions: string[] = [];

  for (const file of fileList.slice(0, 30)) {
    const metadata = Array.isArray(file.file_metadata)
      ? file.file_metadata[0]
      : null;

    if (metadata?.extra && typeof metadata.extra === 'object') {
      if ((metadata.extra as Record<string, unknown>).has_text === true) {
        textFileCount++;
      }
      if ((metadata.extra as Record<string, unknown>).has_text === false) {
        pendingExtractionCount++;
      }
    }

    const fileSummary = metadata?.summary
      ? metadata.summary.slice(0, 200)
      : 'No summary available';
    const fileTags = metadata?.tags?.join(', ') || 'none';

    fileDescriptions.push(
      `File: ${file.original_name} (${file.mime_type})\nSummary: ${fileSummary}\nTags: ${fileTags}`
    );
  }

  if (fileList.length > 0) {
    try {
      const prompt = `Analyze this folder containing ${fileCount} files and generate a folder-level context summary.

Files in folder:
${fileDescriptions.join('\n\n')}

Return ONLY a JSON object (no commentary) with this structure:
{
  "summary": "3-6 sentences describing what this folder contains and its purpose",
  "tags": ["5-15", "lowercase", "hyphenated", "tags"],
  "extra_context": {
    "dominant_topics": ["topic1", "topic2"],
    "key_entities": ["entity1", "entity2"],
    "date_range": "unknown or guessed date range",
    "confidence": 0.85,
    "file_count": ${fileCount},
    "text_file_count": ${textFileCount},
    "pending_extraction_count": ${pendingExtractionCount}
  }
}`;

      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      });

      const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      summary = parsed.summary;
      tags = parsed.tags;
      extraContext = parsed.extra_context;
    } catch (err) {
      console.error('Claude folder context generation failed:', err);
      summary = 'Folder context not available.';
      tags = ['no-context', 'llm-error'];
      extraContext = {
        file_count: fileCount,
        text_file_count: textFileCount,
        pending_extraction_count: pendingExtractionCount,
        error: true
      };
    }
  } else {
    summary = 'Empty folder.';
    tags = ['empty'];
    extraContext = {
      file_count: 0,
      text_file_count: 0,
      pending_extraction_count: 0
    };
  }

  const { data: existing } = await supabase
    .from('folder_metadata')
    .select('id')
    .eq('folder_id', folderId)
    .eq('user_id', user.id)
    .single();

  if (existing) {
    await supabase
      .from('folder_metadata')
      .update({
        summary,
        tags,
        extra: extraContext,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('folder_metadata')
      .insert({
        folder_id: folderId,
        user_id: user.id,
        summary,
        tags,
        extra: extraContext
      });
  }

  return NextResponse.json({
    status: 'ok',
    metadata: { summary, tags, extra: extraContext }
  });
}
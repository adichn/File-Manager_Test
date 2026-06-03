// src/lib/ai/orchestrator.ts

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

if (!anthropicApiKey) {
  throw new Error('Missing ANTHROPIC_API_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const anthropic = new Anthropic({ apiKey: anthropicApiKey });

interface ExtractionResult {
  text: string;
  method: string;
  warnings: string[];
}

interface ClaudeContext {
  summary: string;
  tags: string[];
  extra_context: {
    document_type?: string;
    entities?: string[];
    date_range?: string;
    confidence?: number;
    [key: string]: unknown;
  };
}

interface MetadataExtra {
  file_name: string;
  mime_type: string;
  size_bytes: number;
  extraction_method: string;
  extraction_warnings: string[];
  has_text: boolean;
  text_length: number;
  chunk_count: number;
  context_generation_status: 'success' | 'skipped_no_text' | 'failed';
  document_type?: string;
  entities?: string[];
  date_range?: string;
  confidence?: number;
  error?: string;
  database_record?: Record<string, unknown>;
  [key: string]: unknown;
}

async function extractBestEffortText(
  blob: Blob,
  mimeType: string,
  fileName: string
): Promise<ExtractionResult> {
  const isTextType = mimeType.startsWith('text/');
  const textExtensions = ['.txt', '.md', '.csv', '.json', '.log'];
  const hasTextExtension = textExtensions.some(ext => 
    fileName.toLowerCase().endsWith(ext)
  );

  if (isTextType || hasTextExtension) {
    try {
      const text = await blob.text();
      return {
        text,
        method: 'blob.text',
        warnings: []
      };
    } catch (err) {
      return {
        text: '',
        method: 'none',
        warnings: [`blob.text failed: ${err instanceof Error ? err.message : String(err)}`]
      };
    }
  }

  return {
    text: '',
    method: 'none',
    warnings: ['no_text_extracted_for_type']
  };
}

function getFileExtension(fileName: string | undefined | null): string {
  if (!fileName) {
    return 'unknown';
  }
  const parts = fileName.split('.');
  if (parts.length > 1) {
    return parts[parts.length - 1].toLowerCase();
  }
  return 'unknown';
}

function chunkAndSample(text: string, maxSampleLength: number = 6000): string {
  if (text.length <= maxSampleLength) {
    return text;
  }

  const chunkSize = Math.floor(maxSampleLength / 3);
  const start = text.slice(0, chunkSize);
  const middleIndex = Math.floor(text.length / 2);
  const middle = text.slice(middleIndex - Math.floor(chunkSize / 2), middleIndex + Math.floor(chunkSize / 2));
  const end = text.slice(-chunkSize);

  return `${start}\n\n[... middle section ...]\n\n${middle}\n\n[... final section ...]\n\n${end}`;
}

async function generateCompressedContext(text: string): Promise<ClaudeContext | null> {
  try {
    const sampledText = chunkAndSample(text, 6000);
    
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: `Analyze this document and return ONLY a JSON object (no commentary) with this structure:
{
  "summary": "a concise summary",
  "tags": ["relevant", "tags"],
  "extra_context": {
    "document_type": "report|email|code|etc",
    "entities": ["key entities mentioned"],
    "date_range": "if applicable",
    "confidence": 0.9
  }
}

Document content:
${sampledText}`
        }
      ]
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const context = JSON.parse(jsonMatch[0]) as ClaudeContext;
    return context;
  } catch (err) {
    console.error('Claude context generation failed:', err);
    return null;
  }
}

async function stubEmbeddings(_fileId: string): Promise<void> {
  // embeddings not yet implemented
}

async function recomputeFolderContextIfNeeded(folderId: string, userId: string): Promise<void> {
  try {
  
    const { data: files, error: filesError } = await supabase
      .from('files')
      .select('id, original_name, mime_type, file_metadata(summary, tags, extra)')
      .eq('user_id', userId)
      .eq('folder_id', folderId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (filesError) {
      console.error(`[${folderId}] Failed to fetch files for folder context:`, filesError);
      return;
    }

    const fileList = files || [];
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
        console.error(`[${folderId}] Claude folder context generation failed:`, err);
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
      .eq('user_id', userId)
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
          user_id: userId,
          summary,
          tags,
          extra: extraContext
        });
    }

  } catch (err) {
    console.error(`[${folderId}] Failed to recompute folder context:`, err);
  }
}

export async function orchestrateFileIngestion(params: {
  fileId: string;
  userId: string;
}): Promise<void> {
  const { fileId, userId } = params;


  const { data: fileRecord, error: fileError } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .eq('user_id', userId)
    .single();

  if (fileError || !fileRecord) {
    throw new Error(`File not found or access denied: ${fileId}`);
  }

  const fileName = fileRecord.original_name || `file_${fileId}`;
  const filePath = fileRecord.storage_path;
  const mimeType = fileRecord.mime_type || 'application/octet-stream';
  const sizeBytes = fileRecord.size_bytes || 0;
  const folderId = fileRecord.folder_id;


  if (!filePath) {
    console.error(`[${fileId}] No file path found in database record:`, fileRecord);
    await saveFallbackMetadata(fileId, userId, fileName, mimeType, sizeBytes, {
      error: 'no_file_path_in_database',
      database_record: fileRecord as Record<string, unknown>
    });
    return;
  }

  let blob: Blob;
  try {
    const { data: blobData, error: downloadError } = await supabase.storage
      .from('files')
      .download(filePath);

    if (downloadError || !blobData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    blob = blobData;
  } catch (err) {
    console.error(`[${fileId}] Download failed:`, err);
    await saveFallbackMetadata(fileId, userId, fileName, mimeType, sizeBytes, {
      error: `download_failed: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  const extraction = await extractBestEffortText(blob, mimeType, fileName);

  const hasText = extraction.text.length >= 200;

  let contextGenerationStatus: 'success' | 'skipped_no_text' | 'failed' = 'skipped_no_text';
  let claudeContext: ClaudeContext | null = null;

  if (hasText) {
    claudeContext = await generateCompressedContext(extraction.text);
    contextGenerationStatus = claudeContext ? 'success' : 'failed';
  }

  let summary: string;
  let tags: string[];
  let extra: MetadataExtra;

  if (claudeContext) {
    summary = claudeContext.summary;
    tags = claudeContext.tags;
    extra = {
      ...claudeContext.extra_context,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      extraction_method: extraction.method,
      extraction_warnings: extraction.warnings,
      has_text: true,
      text_length: extraction.text.length,
      chunk_count: 1,
      context_generation_status: contextGenerationStatus
    };
  } else {
    const extension = getFileExtension(fileName);
    summary = `File: ${fileName} (${mimeType}, ${sizeBytes} bytes). Content extraction pending.`;
    tags = [extension, 'extraction-pending', 'no-text'];
    extra = {
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      extraction_method: extraction.method,
      extraction_warnings: extraction.warnings,
      has_text: false,
      text_length: extraction.text.length,
      chunk_count: 0,
      context_generation_status: contextGenerationStatus
    };
  }

  await upsertMetadata(fileId, userId, summary, tags, extra);
  await stubEmbeddings(fileId);

  if (folderId) {
    recomputeFolderContextIfNeeded(folderId, userId).catch((err) => {
      console.error(`[${fileId}] Failed to trigger folder context recomputation:`, err);
    });
  }

}

async function upsertMetadata(
  fileId: string,
  userId: string,
  summary: string,
  tags: string[],
  extra: MetadataExtra
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('file_metadata')
      .select('id')
      .eq('file_id', fileId)
      .eq('user_id', userId)
      .single();

    if (existing) {
      const { error: updateError } = await supabase
        .from('file_metadata')
        .update({
          summary,
          tags,
          extra,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error(`[${fileId}] Metadata update failed:`, updateError);
      }
    } else {
      const { error: insertError } = await supabase
        .from('file_metadata')
        .insert({
          id: crypto.randomUUID(),
          file_id: fileId,
          user_id: userId,
          summary,
          tags,
          extra,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (insertError) {
        console.error(`[${fileId}] Metadata insert failed:`, insertError);
      }
    }
  } catch (err) {
    console.error(`[${fileId}] Metadata upsert error:`, err);
  }
}

async function saveFallbackMetadata(
  fileId: string,
  userId: string,
  fileName: string | undefined | null,
  mimeType: string,
  sizeBytes: number,
  errorInfo: Partial<MetadataExtra>
): Promise<void> {
  const safeFileName = fileName || `file_${fileId}`;
  const extension = getFileExtension(fileName);
  const summary = `File: ${safeFileName} (${mimeType}, ${sizeBytes} bytes). Processing failed.`;
  const tags = [extension, 'processing-failed'];
  const extra: MetadataExtra = {
    file_name: safeFileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    extraction_method: 'none',
    extraction_warnings: [],
    has_text: false,
    text_length: 0,
    chunk_count: 0,
    context_generation_status: 'failed',
    ...errorInfo
  };

  await upsertMetadata(fileId, userId, summary, tags, extra);
}
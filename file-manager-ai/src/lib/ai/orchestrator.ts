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
    [key: string]: any;
  };
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

async function stubEmbeddings(fileId: string): Promise<void> {
  console.log(`[${fileId}] Embeddings disabled — skipping.`);
}

export async function orchestrateFileIngestion(params: {
  fileId: string;
  userId: string;
}): Promise<void> {
  const { fileId, userId } = params;

  console.log(`[${fileId}] Starting orchestration for user ${userId}`);

  const { data: fileRecord, error: fileError } = await supabase
    .from('files')
    .select('*')
    .eq('id', fileId)
    .eq('user_id', userId)
    .single();

  if (fileError || !fileRecord) {
    throw new Error(`File not found or access denied: ${fileId}`);
  }

  const fileName = fileRecord.name || fileRecord.file_name || `file_${fileId}`;
  const filePath = fileRecord.path || fileRecord.file_path || fileRecord.storage_path;
  const mimeType = fileRecord.mime_type || fileRecord.type || 'application/octet-stream';
  const sizeBytes = fileRecord.size || fileRecord.file_size || 0;

  console.log(`[${fileId}] File: ${fileName}, Type: ${mimeType}, Size: ${sizeBytes} bytes`);

  if (!filePath) {
    console.error(`[${fileId}] No file path found in database record:`, fileRecord);
    await saveFallbackMetadata(fileId, userId, fileName, mimeType, sizeBytes, {
      error: 'no_file_path_in_database',
      database_record: fileRecord
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
  console.log(`[${fileId}] Extraction method: ${extraction.method}, Text length: ${extraction.text.length}, Warnings: ${extraction.warnings.join(', ') || 'none'}`);

  const hasText = extraction.text.length >= 200;

  let contextGenerationStatus: 'success' | 'skipped_no_text' | 'failed' = 'skipped_no_text';
  let claudeContext: ClaudeContext | null = null;

  if (hasText) {
    console.log(`[${fileId}] Generating compressed context with Claude...`);
    claudeContext = await generateCompressedContext(extraction.text);
    contextGenerationStatus = claudeContext ? 'success' : 'failed';
  } else {
    console.log(`[${fileId}] Text too short or unavailable — skipping Claude context generation`);
  }

  let summary: string;
  let tags: string[];
  let extra: any;

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

  console.log(`[${fileId}] Orchestration complete`);
}

async function upsertMetadata(
  fileId: string,
  userId: string,
  summary: string,
  tags: string[],
  extra: any
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
      } else {
        console.log(`[${fileId}] Metadata updated successfully`);
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
      } else {
        console.log(`[${fileId}] Metadata inserted successfully`);
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
  errorInfo: any
): Promise<void> {
  const safeFileName = fileName || `file_${fileId}`;
  const extension = getFileExtension(fileName);
  const summary = `File: ${safeFileName} (${mimeType}, ${sizeBytes} bytes). Processing failed.`;
  const tags = [extension, 'processing-failed'];
  const extra = {
    file_name: safeFileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    has_text: false,
    context_generation_status: 'failed',
    ...errorInfo
  };

  await upsertMetadata(fileId, userId, summary, tags, extra);
}
// src/lib/ai/orchestrator.ts
// This module is server-only. Do not import it from client components.

import { createClient } from '@supabase/supabase-js'
import { ChatAnthropic } from '@langchain/anthropic'

function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)')
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
  })
}

async function extractTextFromFile(blob: Blob, mimeType: string): Promise<string> {
  if (mimeType.startsWith('text/')) {
    return await blob.text()
  }

  if (mimeType === 'application/pdf') {
    try {
      // Fix: Import the module correctly
      const pdfParse = (await import('pdf-parse')).default
      
      const arrayBuffer = await blob.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const data = await pdfParse(buffer)
      return data.text || ''
    } catch (error) {
      console.error('PDF extraction failed:', error)
      throw new Error(`PDF text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return ''
}

function chunkText(text: string, chunkSize: number = 2500): string[] {
  const chunks: string[] = []
  
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize))
  }
  
  return chunks.length > 0 ? chunks : []
}

function buildSampleForContext(chunks: string[]): string {
  if (chunks.length === 0) return ''
  
  if (chunks.length <= 2) {
    return chunks.join('\n\n────────────────────────\n\n')
  }

  const first = chunks[0]
  const middle = chunks[Math.floor(chunks.length / 2)]
  const last = chunks[chunks.length - 1]

  const sample = [
    '=== BEGINNING OF DOCUMENT ===',
    first,
    '',
    '=== MIDDLE OF DOCUMENT ===',
    middle,
    '',
    '=== END OF DOCUMENT ===',
    last,
  ].join('\n')

  const maxLength = 6000
  return sample.length > maxLength ? sample.slice(0, maxLength) : sample
}

async function generateCompressedContextWithClaude(params: {
  fileName: string
  mimeType: string
  textLength: number
  numChunks: number
  sample: string
}): Promise<{
  summary: string
  tags: string[]
  extraContext: Record<string, unknown>
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set')
  }

  const model = new ChatAnthropic({
    modelName: 'claude-sonnet-4-5-20250929',
    apiKey,
    temperature: 0.2,
  })

  const prompt = `You are analyzing a document to create rich, searchable metadata. You are seeing SAMPLE SLICES ONLY (beginning, middle, and end) - NOT the entire document.

File Information:
- Name: ${params.fileName}
- Type: ${params.mimeType}
- Length: ${params.textLength} characters
- Total chunks: ${params.numChunks}

Sample Content (beginning/middle/end slices):
${params.sample}

Based on these samples, create comprehensive metadata for this document.

IMPORTANT INSTRUCTIONS:
1. The "summary" should be 3-6 sentences describing what this document is ABOUT (its purpose, topics, key information) - NOT just "a PDF titled X" or "a text file about Y". Provide actual content summary when text is available.
2. Create 5-12 short, relevant, lowercase keyword tags using hyphens for multi-word concepts (e.g. "financial-report", "datafloat", "project-brief")
3. Infer the document type from the list provided
4. Extract important entities (companies, people, products, locations)
5. Identify any date ranges or time periods mentioned

You MUST output ONLY valid JSON in this EXACT format with NO preamble, NO markdown formatting, NO extra text:

{
  "summary": "A comprehensive 3-6 sentence description of what this document is about, its purpose, key topics, and context. Focus on actual content, not just metadata.",
  "tags": ["keyword-tag-1", "keyword-tag-2", "keyword-tag-3", "keyword-tag-4", "keyword-tag-5", "etc"],
  "extra_context": {
    "document_type": "one of: financial_report, invoice, contract, meeting_notes, requirements_doc, slide_deck, academic_assignment, email, other",
    "entities": ["Entity 1", "Entity 2", "Entity 3"],
    "date_range": "e.g. 2024, 2023-2024, Jan-2025, Q3-2024, or unknown",
    "confidence": 0.85
  }
}

Output ONLY the JSON object, nothing else.`

  const response = await model.invoke(prompt)
  const content = response.content as string

  const cleaned = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()
  
  const parsed = JSON.parse(cleaned)

  return {
    summary: parsed.summary || 'No summary available',
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    extraContext: parsed.extra_context || {},
  }
}

async function upsertFileMetadata(params: {
  supabase: ReturnType<typeof createServiceSupabaseClient>
  fileId: string
  userId: string
  summary: string
  tags: string[]
  extraContext: Record<string, unknown>
}): Promise<void> {
  const { error } = await params.supabase
    .from('file_metadata')
    .upsert({
      file_id: params.fileId,
      user_id: params.userId,
      summary: params.summary,
      tags: params.tags,
      extra: params.extraContext,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    console.error('Failed to upsert file_metadata:', error)
    throw error
  }
}

async function embedAndStoreChunks(params: {
  supabase: ReturnType<typeof createServiceSupabaseClient>
  fileId: string
  userId: string
  chunks: string[]
}): Promise<void> {
  console.warn('Embeddings are currently disabled; skipping embedding generation.')
}

export async function orchestrateFileIngestion(params: {
  fileId: string
  userId: string
}): Promise<void> {
  console.log('Starting ingestion for file', params.fileId)

  const supabase = createServiceSupabaseClient()

  const { data: file, error: fileError } = await supabase
    .from('files')
    .select('*')
    .eq('id', params.fileId)
    .single()

  if (fileError || !file) {
    throw new Error(`File not found: ${params.fileId}`)
  }

  if (file.user_id !== params.userId) {
    throw new Error(`User ${params.userId} does not own file ${params.fileId}`)
  }

  console.log('Processing file:', file.original_name)

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from('files')
    .download(file.storage_path)

  if (downloadError || !fileBlob) {
    throw new Error(`Failed to download file: ${downloadError?.message}`)
  }

  let text: string
  try {
    text = await extractTextFromFile(fileBlob, file.mime_type)
  } catch (error) {
    console.error('Failed to extract text:', error)
    
    await upsertFileMetadata({
      supabase,
      fileId: params.fileId,
      userId: params.userId,
      summary: 'No textual content available or PDF text extraction failed.',
      tags: ['no-text', 'extraction-failed'],
      extraContext: {
        document_type: 'unknown',
        reason: 'text_extraction_failed',
        mime_type: file.mime_type,
      },
    })

    console.log('Created minimal metadata for file with extraction failure')
    return
  }

  if (!text || text.length < 50) {
    console.log('File has minimal or no extractable content')
    
    await upsertFileMetadata({
      supabase,
      fileId: params.fileId,
      userId: params.userId,
      summary: 'No textual content available or unsupported file type.',
      tags: ['no-text', 'unsupported-type'],
      extraContext: {
        document_type: 'unknown',
        reason: 'no_meaningful_content',
        mime_type: file.mime_type,
      },
    })

    console.log('Created minimal metadata for file with no content')
    return
  }

  const chunks = chunkText(text)
  console.log(`Split text into ${chunks.length} chunks`)

  const sample = buildSampleForContext(chunks)

  let summary: string
  let tags: string[]
  let extraContext: Record<string, unknown>

  try {
    console.log('Calling Claude to generate compressed context...')
    const result = await generateCompressedContextWithClaude({
      fileName: file.original_name,
      mimeType: file.mime_type,
      textLength: text.length,
      numChunks: chunks.length,
      sample,
    })
    summary = result.summary
    tags = result.tags
    extraContext = result.extraContext
  } catch (error) {
    console.error('Failed to generate context with Claude:', error)
    summary = 'AI context not available for this file.'
    tags = ['no-context', 'llm-error']
    extraContext = {
      document_type: 'unknown',
      entities: [],
      date_range: 'unknown',
      confidence: 0,
      error: 'llm_context_generation_failed',
    }
  }

  await upsertFileMetadata({
    supabase,
    fileId: params.fileId,
    userId: params.userId,
    summary,
    tags,
    extraContext,
  })

  console.log('Stored compressed context in file_metadata')

  await embedAndStoreChunks({
    supabase,
    fileId: params.fileId,
    userId: params.userId,
    chunks,
  })

  console.log('Embeddings disabled; skipping embedding generation')
  console.log('✅ Finished ingestion for file', params.fileId)
}
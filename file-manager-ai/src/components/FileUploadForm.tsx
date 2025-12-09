// src/components/FileUploadForm.tsx
'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function FileUploadForm() {
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setMessage(null)
    setUploading(true)

    const formData = new FormData(e.currentTarget)
    const file = formData.get('file') as File

    if (!file || file.size === 0) {
      setMessage({ type: 'error', text: 'Please select a file' })
      setUploading(false)
      return
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      setMessage({ type: 'success', text: 'Upload successful' })
      formRef.current?.reset()
      router.refresh()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to upload',
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Upload File</h2>
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="file"
            name="file"
            disabled={uploading}
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={uploading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        {message && (
          <div
            className={`p-3 rounded-md ${
              message.type === 'success'
                ? 'bg-green-50 text-green-800'
                : 'bg-red-50 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}
      </form>
    </div>
  )
}
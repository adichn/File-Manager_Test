// src/app/dashboard/page.tsx

'use client';

import { useEffect, useState, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

interface SearchResult {
  file_id: string;
  original_name: string;
  mime_type: string;
  created_at: string;
  folder_id: string | null;
  summary: string | null;
  tags: string[];
  extra: {
    has_text?: boolean;
    [key: string]: unknown;
  } | null;
}

interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  metadata: {
    summary: string | null;
    tags: string[];
    extra: Record<string, unknown> | null;
  } | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [refreshingFolderContext, setRefreshingFolderContext] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push('/login');
        return;
      }
      
      setUser(user);
      await loadFolders();
      await performSearch('');
    };

    checkAuth();
  }, []);

  const loadFolders = async () => {
    try {
      const response = await fetch('/api/folders');
      if (!response.ok) throw new Error('Failed to load folders');
      
      const data = await response.json();
      setFolders(data.folders || []);
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim() })
      });

      if (!response.ok) throw new Error('Failed to create folder');

      setNewFolderName('');
      setShowNewFolderInput(false);
      await loadFolders();
    } catch (err) {
      console.error('Failed to create folder:', err);
      setUploadStatus('Failed to create folder');
      setTimeout(() => setUploadStatus(null), 3000);
    }
  };

  const performSearch = async (searchQuery: string) => {
    setLoading(true);
    setError(null);

    try {
      let url = '/api/search';
      const params = new URLSearchParams();
      
      if (searchQuery.trim()) {
        params.append('q', searchQuery);
      }
      
      if (selectedFolderId) {
        params.append('folderId', selectedFolderId);
      } else if (selectedFolderId === null && !searchQuery.trim()) {
        params.append('folderId', 'root');
      }
      
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      
      if (selectedFolderId) {
        formData.append('folderId', selectedFolderId);
      }

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      setUploadStatus('File uploaded successfully!');
      setTimeout(() => setUploadStatus(null), 3000);
      
      await performSearch(query);
      await loadFolders();
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : 'Upload failed');
      console.error('Upload error:', err);
      setTimeout(() => setUploadStatus(null), 5000);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRefreshFolderContext = async () => {
    if (!selectedFolderId) return;

    setRefreshingFolderContext(true);

    try {
      const response = await fetch(`/api/folders/${selectedFolderId}/context`, {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to refresh folder context');

      await loadFolders();
      setUploadStatus('Folder context refreshed!');
      setTimeout(() => setUploadStatus(null), 3000);
    } catch (err) {
      console.error('Failed to refresh folder context:', err);
      setUploadStatus('Failed to refresh folder context');
      setTimeout(() => setUploadStatus(null), 3000);
    } finally {
      setRefreshingFolderContext(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const selectedFolder = selectedFolderId
    ? folders.find(f => f.id === selectedFolderId)
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">File Manager</h1>
          <div className="flex items-center gap-4">
            {user && (
              <span className="text-sm text-gray-600">{user.email}</span>
            )}
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Folders</h2>
              <button
                onClick={() => setShowNewFolderInput(!showNewFolderInput)}
                className="px-2 py-1 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                + New
              </button>
            </div>

            {showNewFolderInput && (
              <div className="mb-4 flex gap-2">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Folder name"
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                  onKeyPress={(e) => e.key === 'Enter' && createFolder()}
                />
                <button
                  onClick={createFolder}
                  className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Add
                </button>
              </div>
            )}

            <div className="space-y-1">
              <button
                onClick={() => {
                  setSelectedFolderId(null);
                  performSearch(query);
                }}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  selectedFolderId === null
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                📁 All Files
              </button>

              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => {
                    setSelectedFolderId(folder.id);
                    performSearch(query);
                  }}
                  className={`w-full text-left px-3 py-2 rounded text-sm ${
                    selectedFolderId === folder.id
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  📂 {folder.name}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {selectedFolder?.metadata && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-gray-900">Folder Context</h3>
                  <button
                    onClick={handleRefreshFolderContext}
                    disabled={refreshingFolderContext}
                    className="text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                  >
                    {refreshingFolderContext ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                {selectedFolder.metadata.summary && (
                  <p className="text-sm text-gray-700 mb-2">
                    {selectedFolder.metadata.summary}
                  </p>
                )}
                {selectedFolder.metadata.tags && selectedFolder.metadata.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedFolder.metadata.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mb-6 flex gap-4 items-center">
              <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search files${selectedFolder ? ` in ${selectedFolder.name}` : ''}...`}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </form>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={uploading}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {uploading ? 'Uploading...' : '+ Upload'}
                </button>
              </div>
            </div>

            {uploadStatus && (
              <div className={`mb-4 p-3 rounded-lg ${
                uploadStatus.includes('success') || uploadStatus.includes('refreshed')
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}>
                <p className={`text-sm ${
                  uploadStatus.includes('success') || uploadStatus.includes('refreshed')
                    ? 'text-green-800'
                    : 'text-red-800'
                }`}>
                  {uploadStatus}
                </p>
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            {loading && results.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">Loading...</p>
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No files found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {results.map((result) => (
                  <div
                    key={result.file_id}
                    className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 mb-1">
                          {result.original_name}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-gray-500">
                          <span>{result.mime_type}</span>
                          <span>•</span>
                          <span>{formatDate(result.created_at)}</span>
                        </div>
                      </div>
                      {result.extra?.has_text === false && (
                        <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">
                          Extraction Pending
                        </span>
                      )}
                    </div>

                    {result.summary && (
                      <p className="text-gray-700 mb-3 line-clamp-3">
                        {result.summary}
                      </p>
                    )}

                    {result.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {result.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
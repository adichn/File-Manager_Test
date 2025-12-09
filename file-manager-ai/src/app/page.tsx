import Link from 'next/link'

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-bold text-gray-900 tracking-tight">
          File Manager AI
        </h1>
        
        <p className="text-xl text-gray-600 leading-relaxed">
          Organize, search, and manage your files with the power of AI. 
          Intelligent categorization, semantic search, and automated workflows 
          to keep your digital life in order.
        </p>

        <div className="pt-4">
          <Link
            href="/dashboard"
            className="inline-block px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}

// src/components/UserMenu.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface UserMenuProps {
  initialEmail?: string
}

export default function UserMenu({ initialEmail }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  const getInitial = () => {
    if (initialEmail) {
      return initialEmail.charAt(0).toUpperCase()
    }
    return 'U'
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold hover:bg-blue-700 transition-colors"
      >
        {getInitial()}
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-20 border border-gray-200">
            {initialEmail && (
              <div className="px-4 py-2 text-sm text-gray-700 border-b border-gray-200">
                {initialEmail}
              </div>
            )}
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
'use client'

import { useEffect } from 'react'

export function PwaRegistration() {
  useEffect(() => {
    if ('serviceWorker' in window.navigator) void window.navigator.serviceWorker.register('/sw.js')
  }, [])
  return null
}

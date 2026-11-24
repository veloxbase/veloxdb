import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { HotkeysProvider } from '@tanstack/react-hotkeys'

import './i18n'
import './index.css'
import App from './App.tsx'

import { Toaster } from '@/components/ui/toaster'
import { createQueryClient } from '@/data/query-client'

const queryClient = createQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HotkeysProvider>
        <App />
        <Toaster />
      </HotkeysProvider>
    </QueryClientProvider>
  </StrictMode>,
)


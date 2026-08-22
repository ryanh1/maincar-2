import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import './index.css'
import App from './App'
import { AudioPlayerFixture } from './components/call-review/AudioPlayerFixture'
import { AccountTimelineFixture } from './components/account-timeline/AccountTimelineFixture'
import { InCallControlsFixture } from './components/dialer/InCallControlsFixture'
import { TooltipProvider } from './components/ui/tooltip'
import { ReportsFixture } from './pages/ReportsFixture'
import { CallTranscriptFixture } from './pages/CallTranscriptFixture'
import { RecordsFixture } from './pages/RecordsFixture'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: true,
      staleTime: 30_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {import.meta.env.DEV && window.location.pathname === '/__fixtures/audio-player' ? (
      <TooltipProvider><AudioPlayerFixture /></TooltipProvider>
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/in-call-controls' ? (
      <InCallControlsFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/account-timeline' ? (
      <AccountTimelineFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/reports' ? (
      <ReportsFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/call-transcript' ? (
      <CallTranscriptFixture />
    ) : import.meta.env.DEV && window.location.pathname.startsWith('/__fixtures/records/') ? (
      <RecordsFixture />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </StrictMode>,
)

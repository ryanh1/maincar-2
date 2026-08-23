import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import './index.css'
import App from './App'
import { AudioPlayerFixture } from './components/call-review/AudioPlayerFixture'
import { AccountTimelineFixture } from './components/account-timeline/AccountTimelineFixture'
import { InCallControlsFixture } from './components/dialer/InCallControlsFixture'
import { InCallWorkspaceFixture } from './components/dialer/InCallWorkspaceFixture'
import { DialerDispositionBarFixture } from './components/dialer/DialerDispositionBarFixture'
import { NumericKeypadFixture } from './components/dialer/NumericKeypadFixture'
import { DialerIncomingCallFixture } from './components/dialer/DialerIncomingCallFixture'
import { TooltipProvider } from './components/ui/tooltip'
import { DatePickerFixture } from './components/ui/DatePickerFixture'
import { ReportsFixture } from './pages/ReportsFixture'
import { CallTranscriptFixture } from './pages/CallTranscriptFixture'
import { RecordsFixture } from './pages/RecordsFixture'
import { ListRecordsFixture } from './pages/ListRecordsFixture'
import { ComposerCardFixture } from './components/composer/ComposerCardFixture'
import { Settings_EmailSignaturesFixture } from './pages/Settings_EmailSignaturesFixture'
import { Settings_EmailTemplatesFixture } from './pages/Settings_EmailTemplatesFixture'
import { MentionEditorFixture } from './components/editor/MentionEditorFixture'
import { Settings_DispositionsFixture } from './pages/Settings_DispositionsFixture'
import { Settings_NextStepsFixture } from './pages/Settings_NextStepsFixture'

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
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/date-picker' ? (
      <DatePickerFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/in-call-controls' ? (
      <InCallControlsFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/in-call-workspace' ? (
      <InCallWorkspaceFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/dialer-disposition-bar' ? (
      <DialerDispositionBarFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/numeric-keypad' ? (
      <NumericKeypadFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/dialer-incoming-call' ? (
      <DialerIncomingCallFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/account-timeline' ? (
      <AccountTimelineFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/reports' ? (
      <ReportsFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/call-transcript' ? (
      <CallTranscriptFixture />
    ) : import.meta.env.DEV && window.location.pathname.startsWith('/__fixtures/records/') ? (
      <RecordsFixture />
    ) : import.meta.env.DEV && window.location.pathname.startsWith('/__fixtures/lists/') ? (
      <ListRecordsFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/composer-focus' ? (
      <ComposerCardFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/email-signatures' ? (
      <Settings_EmailSignaturesFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/email-templates' ? (
      <Settings_EmailTemplatesFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/mention-editor' ? (
      <MentionEditorFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/dispositions' ? (
      <Settings_DispositionsFixture />
    ) : import.meta.env.DEV && window.location.pathname === '/__fixtures/next-steps' ? (
      <Settings_NextStepsFixture />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setToken, start as startGistSync } from './store/gistSync'
import { startUploadWorker } from './store/driveUpload'
import { recoverUnfinishedTakes } from './audio/recordingSession'

// One-tap setup link: https://<app>/#/setup?token=<gist-only token>
// Stores the sync token (and unlocks the secret-word gate) on this device,
// then scrubs the token out of the URL so it never sits in history/bookmarks.
function applySetupLink(): void {
  try {
    const hash = window.location.hash
    if (!hash.startsWith('#/setup')) return
    const query = hash.split('?')[1] ?? ''
    const params = new URLSearchParams(query)
    const token = params.get('token')
    if (token && token.trim()) {
      setToken(token.trim())
      localStorage.setItem('readaloud.unlocked', '1')
    }
    window.history.replaceState(null, '', window.location.pathname + '#/home')
  } catch {
    // ignore - the parent can still paste the token in Settings
  }
}

applySetupLink()

// No-op if the parent hasn't set a GitHub token yet (see Settings screen).
startGistSync()
// Uploads finished reading takes to the parent's Google Drive when configured.
startUploadWorker()
// Turns any partial recording left over from a crash/reload mid-take (see
// audio/recordingSession.ts) into a real, playable take before Home ever
// renders.
void recoverUnfinishedTakes()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

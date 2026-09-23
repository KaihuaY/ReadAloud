import { useState, type CSSProperties } from 'react'
import { isDriveConfigured, uploadNow } from '../store/driveUpload'
import { useProgress, type ReadingTake } from '../store/progress'

const chipTextStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  flexWrap: 'wrap',
  fontSize: '0.8rem',
  color: 'var(--cc-ink-soft)',
}

const linkButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--cc-primary)',
  fontWeight: 800,
  cursor: 'pointer',
  textDecoration: 'underline',
  font: 'inherit',
}

/**
 * The "☁️ ..." Drive-upload status line shown under a take on Home and
 * ParentReview - done/uploading/pending/failed, each phrased for a kid or a
 * tired parent glancing at a phone, not an engineer. Renders nothing when
 * Drive upload isn't configured at all (there's nothing useful to say).
 */
export function UploadChip({ take }: { take: ReadingTake }) {
  const progress = useProgress()
  const [busy, setBusy] = useState(false)

  if (!isDriveConfigured(progress.settings)) return null

  async function handleUploadNow() {
    setBusy(true)
    try {
      await uploadNow(take.id)
    } finally {
      setBusy(false)
    }
  }

  const status = take.upload?.status

  if (status === 'done') {
    return <span style={chipTextStyle}>☁️ Saved to Drive</span>
  }

  if (status === 'uploading') {
    return <span style={chipTextStyle}>☁️ Uploading…</span>
  }

  if (status === 'failed') {
    return (
      <span style={chipTextStyle}>
        ☁️ Upload failed
        <button type="button" style={linkButtonStyle} disabled={busy} onClick={() => void handleUploadNow()}>
          {busy ? 'Trying…' : 'Try again'}
        </button>
      </span>
    )
  }

  // 'pending' or no upload field at all yet - either way it's waiting its turn.
  return (
    <span style={chipTextStyle}>
      ☁️ Uploading soon
      <button type="button" style={linkButtonStyle} disabled={busy} onClick={() => void handleUploadNow()}>
        {busy ? 'Uploading…' : 'Upload now'}
      </button>
    </span>
  )
}

// Which audio mime type MediaRecorder should use, in order of preference:
// Safari only speaks AAC-in-MP4, so that goes first; everything else prefers
// Opus, which is smaller and widely supported.

const PREFERRED_MIME_TYPES = [
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const

function defaultIsSupported(): ((mime: string) => boolean) | null {
  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    return (mime: string) => MediaRecorder.isTypeSupported(mime)
  }
  return null
}

export function pickRecordingMime(isSupported?: (mime: string) => boolean): string | null {
  const check = isSupported ?? defaultIsSupported()
  if (!check) return null
  for (const mime of PREFERRED_MIME_TYPES) {
    if (check(mime)) return mime
  }
  return null
}

export function extensionFor(mime: string): 'm4a' | 'webm' | 'ogg' {
  if (mime.startsWith('audio/mp4')) return 'm4a'
  if (mime.startsWith('audio/ogg')) return 'ogg'
  return 'webm'
}

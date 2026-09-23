// Phase 1 replaces this with the real Gemini "ear" pipeline (see the plan's
// section 3): requesting a scored transcript for a take's audio, retrying on
// transient failures, and a status hook for the UI. Kept as a no-op stub for
// now so recordingSession.ts has something to call.

/** Phase 1 replaces this. */
export async function requestEar(_takeId: string, _blob: Blob): Promise<void> {}

/** Phase 1 replaces this. */
export function useEarStage(): 'idle' {
  return 'idle'
}

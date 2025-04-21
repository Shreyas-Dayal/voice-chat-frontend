// hooks/useAudioContext.ts
import { useCallback, useRef } from 'react';
import { TARGET_SAMPLE_RATE } from '../constants';

export default function useAudioContext() {
  const audioContext = useRef<AudioContext | null>(null);

  const ensure = useCallback(async (): Promise<AudioContext | null> => {
    if (audioContext.current?.state === 'running') {
      return audioContext.current;
    }
    try {
      if (
        !audioContext.current ||
        audioContext.current.state === 'closed'
      ) {
          audioContext.current = new (window.AudioContext ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).webkitAudioContext)({
          sampleRate: TARGET_SAMPLE_RATE,
        });
      }
      if (audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
      }
      if (audioContext.current.state !== 'running') {
        throw new Error(`Failed: ${audioContext.current.state}`);
      }
      return audioContext.current;
    } catch {
      if (audioContext.current) {
        await audioContext.current.close().catch(() => {});
      }
      audioContext.current = null;
      return null;
    }
  }, []);

  return ensure;
}

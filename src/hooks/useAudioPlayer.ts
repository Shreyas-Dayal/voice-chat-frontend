import { useState, useRef, useCallback, useEffect } from 'react';

// --- Utils (with types) ---
function addWavHeader(pcmData: ArrayBuffer, sampleRate: number, numChannels: number, bytesPerSample: number): ArrayBuffer {
    const dataSize = pcmData.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    function writeString(view: DataView, offset: number, string: string) { for (let i = 0; i < string.length; i++) { view.setUint8(offset + i, string.charCodeAt(i)); } }
    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true); writeString(view, 36, 'data'); view.setUint32(40, dataSize, true);
    const pcmView = new Uint8Array(pcmData); const dataView = new Uint8Array(buffer, 44); dataView.set(pcmView);
    return buffer;
}


interface UseAudioPlayerReturn {
    isPlaying: boolean;
    playAudio: (pcmAudioBuffer: ArrayBuffer | null) => Promise<void>;
    stopPlayback: () => void;
    error: string | null;
}

// **** CHANGED: First parameter is now the ensure function ****
export function useAudioPlayer(
    ensureAudioContext: () => Promise<AudioContext | null>,
    sampleRate: number
): UseAudioPlayerReturn {
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

    const playAudio = useCallback(async (pcmAudioBuffer: ArrayBuffer | null): Promise<void> => {
        if (isPlaying) {
            console.warn('[useAudioPlayer] Already playing.');
            return;
        }
        if (!pcmAudioBuffer || pcmAudioBuffer.byteLength === 0) {
            console.warn('[useAudioPlayer] Received empty buffer to play.');
            setIsPlaying(false);
            return;
        }

        setError(null);

        // **** CHANGED: Call ensureAudioContext here ****
        const currentAudioContext = await ensureAudioContext();
        if (!currentAudioContext) { // Check if the function returned null (error)
            console.error('[useAudioPlayer] Failed to get valid AudioContext.');
            setError('Audio system not ready for playback.');
            setIsPlaying(false);
            return;
        }
        // If we get here, currentAudioContext is a valid, running AudioContext

        setIsPlaying(true); // Set state before async decode
        console.log(`[useAudioPlayer] Preparing playback for ${pcmAudioBuffer.byteLength} bytes.`);

        // Stop previous playback source
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.stop(); } catch (e) { console.warn("Stop error:", e); }
            try { sourceNodeRef.current.disconnect(); } catch (e) { console.warn("Disconnect error:", e); }
            sourceNodeRef.current = null;
        }

        try {
            const wavBuffer: ArrayBuffer = addWavHeader(pcmAudioBuffer, sampleRate, 1, 2);
            // Use the guaranteed context
            const decodedData: AudioBuffer = await currentAudioContext.decodeAudioData(wavBuffer);

            // Minimal re-check after await
            if (currentAudioContext.state !== 'running') {
                 console.warn("[useAudioPlayer] AudioContext state changed unexpectedly after decode.");
                 setIsPlaying(false);
                 return;
            }

            const source: AudioBufferSourceNode = currentAudioContext.createBufferSource();
            source.buffer = decodedData;
            source.connect(currentAudioContext.destination);

            source.onended = () => {
                console.log('[useAudioPlayer] Playback finished.');
                setIsPlaying(false);
                if (sourceNodeRef.current === source) {
                    sourceNodeRef.current = null;
                }
                try { source.disconnect(); } catch(e) {console.log(e)}
            };

            sourceNodeRef.current = source;
            source.start(0);
            console.log('[useAudioPlayer] Playback started.');

        } catch (err) {
            console.error('[useAudioPlayer] Error during playback:', err);
            setError(`Audio playback error: ${err instanceof Error ? err.message : String(err)}`);
            setIsPlaying(false);
            sourceNodeRef.current = null;
        }
    // **** CHANGED: Update dependencies ****
    }, [isPlaying, ensureAudioContext, sampleRate]);

    const stopPlayback = useCallback(() => {
        if (sourceNodeRef.current) {
            console.log('[useAudioPlayer] Stopping playback manually.');
            try {
                sourceNodeRef.current.stop();
                // onended should handle state/ref cleanup
            } catch (e) {
                console.warn('[useAudioPlayer] Error stopping node:', e);
                 if (sourceNodeRef.current) {
                     try { sourceNodeRef.current.disconnect(); } catch (e) { console.log(e) }
                 }
                 setIsPlaying(false);
                 sourceNodeRef.current = null;
            }
        } else {
           if (isPlaying) setIsPlaying(false);
        }
   }, [isPlaying]);

   // Cleanup effect
   useEffect(() => {
       return () => {
           // Ensure playback stops if the component unmounts while playing
            if (sourceNodeRef.current) {
               try { sourceNodeRef.current.stop(); } catch (e) { console.log(e) }
               try { sourceNodeRef.current.disconnect(); } catch (e) { console.log(e) }
               sourceNodeRef.current = null;
            }
       };
   }, []); // Run only on unmount


    return {
        isPlaying,
        playAudio,
        stopPlayback,
        error
    };
}

// import { useState, useRef, useCallback, useEffect } from 'react';

// // --- Utils (with types) ---
// function addWavHeader(pcmData: ArrayBuffer, sampleRate: number, numChannels: number, bytesPerSample: number): ArrayBuffer {
//     const dataSize = pcmData.byteLength;
//     const buffer = new ArrayBuffer(44 + dataSize);
//     const view = new DataView(buffer);
//     function writeString(view: DataView, offset: number, string: string) { for (let i = 0; i < string.length; i++) { view.setUint8(offset + i, string.charCodeAt(i)); } }
//     writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(view, 8, 'WAVE');
//     writeString(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
//     view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
//     view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); view.setUint16(32, numChannels * bytesPerSample, true);
//     view.setUint16(34, bytesPerSample * 8, true); writeString(view, 36, 'data'); view.setUint32(40, dataSize, true);
//     const pcmView = new Uint8Array(pcmData); const dataView = new Uint8Array(buffer, 44); dataView.set(pcmView);
//     return buffer;
// }

// // Type for the hook's return value
// interface UseAudioPlayerReturn {
//     isPlaying: boolean;
//     playAudio: (pcmAudioBuffer: ArrayBuffer | null) => Promise<void>;
//     stopPlayback: () => void;
//     error: string | null;
// }

// // Hook definition with typed parameters
// export function useAudioPlayer(
//     audioContext: AudioContext | null,
//     sampleRate: number
// ): UseAudioPlayerReturn {
//     const [isPlaying, setIsPlaying] = useState<boolean>(false);
//     const [error, setError] = useState<string | null>(null);
//     const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

//     const playAudio = useCallback(async (pcmAudioBuffer: ArrayBuffer | null): Promise<void> => {
//         // Check current state and context validity first
//         if (isPlaying) {
//             console.warn('[useAudioPlayer] Already playing.');
//             return;
//         }
//         if (!audioContext || audioContext.state !== 'running') {
//             console.error('[useAudioPlayer] AudioContext not available or not running.');
//             setError('Audio system not ready for playback.');
//             setIsPlaying(false); // Ensure state is false if context fails
//             return;
//         }
//         if (!pcmAudioBuffer || pcmAudioBuffer.byteLength === 0) {
//             console.warn('[useAudioPlayer] Received empty buffer to play.');
//             setIsPlaying(false); // Ensure state is false if nothing to play
//             return;
//         }

//         setError(null);
//         setIsPlaying(true); // Set state before async operations
//         console.log(`[useAudioPlayer] Preparing playback for ${pcmAudioBuffer.byteLength} bytes.`);

//         // Stop any previous playback source
//         if (sourceNodeRef.current) {
//             try { sourceNodeRef.current.stop(); } catch (e) { console.warn("Stop error:", e); }
//             try { sourceNodeRef.current.disconnect(); } catch (e) { console.warn("Disconnect error:", e); }
//             sourceNodeRef.current = null;
//         }


//         try {
//             // Add WAV header
//             const wavBuffer: ArrayBuffer = addWavHeader(pcmAudioBuffer, sampleRate, 1, 2); // Mono, 16-bit

//             // Decode
//             const decodedData: AudioBuffer = await audioContext.decodeAudioData(wavBuffer);

//             // Re-check context state after await
//             if (!audioContext || audioContext.state !== 'running') {
//                  console.warn("[useAudioPlayer] AudioContext closed before playback could start.");
//                  setIsPlaying(false);
//                  return;
//             }

//             // Create and configure source node
//             const source: AudioBufferSourceNode = audioContext.createBufferSource();
//             source.buffer = decodedData;
//             source.connect(audioContext.destination);

//             source.onended = () => {
//                 console.log('[useAudioPlayer] Playback finished.');
//                 setIsPlaying(false);
//                  // Check ref before clearing, ensure it's the *same* node
//                 if (sourceNodeRef.current === source) {
//                     sourceNodeRef.current = null;
//                 }
//                 // Explicitly disconnect after finished
//                 try { source.disconnect(); } catch(e) {console.log(e)}
//             };

//             // Store ref and start
//             sourceNodeRef.current = source;
//             source.start(0);
//             console.log('[useAudioPlayer] Playback started.');

//         } catch (err) {
//             console.error('[useAudioPlayer] Error during playback:', err);
//             setError(`Audio playback error: ${err instanceof Error ? err.message : String(err)}`);
//             setIsPlaying(false); // Revert state on error
//             sourceNodeRef.current = null; // Clear ref on error
//         }
//     }, [isPlaying, audioContext, sampleRate]); // Dependencies

//     const stopPlayback = useCallback(() => {
//          if (sourceNodeRef.current) {
//              console.log('[useAudioPlayer] Stopping playback manually.');
//              try {
//                  sourceNodeRef.current.stop();
//                  // onended should fire and handle state/ref cleanup
//              } catch (e) {
//                  console.warn('[useAudioPlayer] Error stopping node:', e);
//                   // Force cleanup if stop fails unexpectedly
//                  if (sourceNodeRef.current) {
//                      try { sourceNodeRef.current.disconnect(); } catch (de) { console.log(de) }
//                  }
//                  setIsPlaying(false);
//                  sourceNodeRef.current = null;
//              }
//          } else {
//             // console.log('[useAudioPlayer] No active playback source to stop.');
//             // Ensure state is false if called when nothing is playing
//             if (isPlaying) setIsPlaying(false);
//          }
//     }, [isPlaying]); // Added isPlaying dependency

//      // Cleanup effect for unmount
//      useEffect(() => {
//         return () => {
//             console.log("[useAudioPlayer] Cleaning up on unmount...");
//             // Ensure playback stops if the component unmounts while playing
//              if (sourceNodeRef.current) {
//                 try { sourceNodeRef.current.stop(); } catch (e) { console.log(e)}
//                 try { sourceNodeRef.current.disconnect(); } catch (e) { console.log(e) }
//                 sourceNodeRef.current = null;
//              }
//         };
//     }, []); // Run only on unmount

//     return {
//         isPlaying,
//         playAudio,
//         stopPlayback,
//         error
//     };
// }
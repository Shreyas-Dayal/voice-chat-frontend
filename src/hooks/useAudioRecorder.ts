import { useState, useRef, useCallback, useEffect } from 'react';

// --- Utils (with types) ---
// (Keep the downsampleBuffer and floatTo16BitPCM functions as they are)
function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
    if (inputSampleRate === outputSampleRate) { return buffer; }
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0, offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++; offsetBuffer = nextOffsetBuffer;
    } return result;
}
function floatTo16BitPCM(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    } return output;
}


interface AudioNodes {
    sourceNode: MediaStreamAudioSourceNode;
    processorNode: ScriptProcessorNode;
}

interface UseAudioRecorderReturn {
    isRecording: boolean;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    error: string | null;
}

export function useAudioRecorder(
    audioContext: AudioContext | null,
    onDataAvailable: (pcmBuffer: ArrayBuffer) => void,
    targetSampleRate: number
): UseAudioRecorderReturn {
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioProcessingNodes = useRef<AudioNodes | null>(null);

    // ** CRITICAL CHANGE: Store isRecording in a ref for direct access in callback **
    const isRecordingRef = useRef<boolean>(false);
    // Update the ref whenever the state changes
    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    // ** CRITICAL CHANGE: Store callback in a ref **
    const onDataAvailableRef = useRef<(pcmBuffer: ArrayBuffer) => void>(onDataAvailable);
    // Keep the ref updated if the passed callback changes identity
    useEffect(() => {
        onDataAvailableRef.current = onDataAvailable;
    }, [onDataAvailable]);


    const stopAudioNodes = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        try {
            if (audioProcessingNodes.current?.processorNode) {
                audioProcessingNodes.current.processorNode.onaudioprocess = null;
                audioProcessingNodes.current.processorNode.disconnect();
                console.log('[useAudioRecorder] Processor node disconnected.');
            }
            if (audioProcessingNodes.current?.sourceNode) {
                audioProcessingNodes.current.sourceNode.disconnect();
                 console.log('[useAudioRecorder] Source node disconnected.');
            }
        } catch (de) {
            console.error("[useAudioRecorder] Disconnect error:", de);
        }
        audioProcessingNodes.current = null;
    }, []);

    const startRecording = useCallback(async (): Promise<void> => {
        // Use the ref here to prevent starting multiple times if state update is slow
        if (isRecordingRef.current) {
            console.warn('[useAudioRecorder] Already recording (ref check).');
            return;
        }
        if (!audioContext || audioContext.state !== 'running') {
            console.error('[useAudioRecorder] AudioContext not available or not running.');
            setError('Audio system not ready.');
            return; // Don't set isRecording true if context failed
        }

        setError(null);
        setIsRecording(true); // Set state AND ref (ref updates via useEffect)

        try {
            console.log('[useAudioRecorder] Requesting microphone access...');
            const stream: MediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            console.log('[useAudioRecorder] Microphone access granted.');

            const sourceNodeMic: MediaStreamAudioSourceNode = audioContext.createMediaStreamSource(stream);
            if (!audioContext.createScriptProcessor) {
                 console.error("ScriptProcessorNode is not supported.");
                 throw new Error("ScriptProcessorNode not supported");
            }
            const processorNode: ScriptProcessorNode = audioContext.createScriptProcessor(4096, 1, 1);
            const inputSampleRate: number = audioContext.sampleRate;
            console.log(`[useAudioRecorder] Mic SR: ${inputSampleRate}, Target SR: ${targetSampleRate}`);

            // *** CRITICAL: Assign the callback HERE ***
            processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
                // ** Access isRecording via the ref inside the callback **
                if (!isRecordingRef.current) {
                    // console.log("[useAudioRecorder] onaudioprocess: Not recording (ref check), returning.");
                    return;
                }

                try {
                    const inputData: Float32Array = e.inputBuffer.getChannelData(0);
                    const downsampledData: Float32Array = downsampleBuffer(inputData, inputSampleRate, targetSampleRate);
                    const pcm16Data: Int16Array = floatTo16BitPCM(downsampledData);
                    const pcmBuffer = pcm16Data.buffer;

                    // ** Access the callback via the ref **
                    if (onDataAvailableRef.current) {
                        // console.log(`[useAudioRecorder] onaudioprocess: Sending ${pcmBuffer.byteLength} bytes via ref callback.`);
                        onDataAvailableRef.current(pcmBuffer);
                    } else {
                         console.warn('[useAudioRecorder] onaudioprocess: onDataAvailableRef.current is null!');
                    }
                } catch (pe) {
                    console.error("[useAudioRecorder] Processing Error in onaudioprocess:", pe);
                    setError(`Audio processing failed: ${pe instanceof Error ? pe.message : String(pe)}`);
                    // Use the state setter, which will trigger the ref update
                    setIsRecording(false);
                    stopAudioNodes(); // Stop nodes on error
                }
            };

            sourceNodeMic.connect(processorNode);
            processorNode.connect(audioContext.destination);
            audioProcessingNodes.current = { sourceNode: sourceNodeMic, processorNode: processorNode };
            console.log('[useAudioRecorder] Recording started.');

        } catch (err) {
            console.error('[useAudioRecorder] Start Recording Error:', err);
             const userMessage = `Recording start failed: ${err instanceof Error ? err.message : String(err)}`;
             if (err instanceof Error) { /* ... error message formatting ... */ }
            setError(userMessage);
            setIsRecording(false); // Revert state on error
            stopAudioNodes();
        }
    // Explicitly list dependencies - crucial!
    }, [audioContext, targetSampleRate, stopAudioNodes, setIsRecording, setError]); // Added state setters


    const stopRecording = useCallback(() => {
        if (!isRecordingRef.current) { // Check ref here too
            // console.log('[useAudioRecorder] Stop called but not recording (ref check).');
            return;
        }
        console.log('[useAudioRecorder] Stopping recording...');
        setIsRecording(false); // Set state first, ref updates via useEffect
        stopAudioNodes(); // Cleanup nodes
        console.log('[useAudioRecorder] Recording stopped.');
    // Explicitly list dependencies
    }, [stopAudioNodes, setIsRecording]); // Added setIsRecording

    // Cleanup effect for unmount
    useEffect(() => {
        return () => {
            console.log("[useAudioRecorder] Cleaning up on unmount...");
             // Use the ref for check during unmount cleanup
             if (isRecordingRef.current) {
                stopAudioNodes();
             }
        };
    }, [stopAudioNodes]); // Only depends on the cleanup function


    return {
        isRecording,
        startRecording,
        stopRecording,
        error
    };
}

// import { useState, useRef, useCallback, useEffect } from 'react';

// // --- Utils (with types) ---
// function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
//     if (inputSampleRate === outputSampleRate) { return buffer; }
//     const sampleRateRatio = inputSampleRate / outputSampleRate;
//     const newLength = Math.round(buffer.length / sampleRateRatio);
//     const result = new Float32Array(newLength);
//     let offsetResult = 0, offsetBuffer = 0;
//     while (offsetResult < result.length) {
//         const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
//         let accum = 0, count = 0;
//         for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; }
//         result[offsetResult] = count > 0 ? accum / count : 0;
//         offsetResult++; offsetBuffer = nextOffsetBuffer;
//     } return result;
// }
// function floatTo16BitPCM(input: Float32Array): Int16Array {
//     const output = new Int16Array(input.length);
//     for (let i = 0; i < input.length; i++) {
//         const s = Math.max(-1, Math.min(1, input[i]));
//         output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
//     } return output;
// }

// // Type for the internal nodes structure
// interface AudioNodes {
//     sourceNode: MediaStreamAudioSourceNode;
//     processorNode: ScriptProcessorNode;
// }

// // Type for the hook's return value
// interface UseAudioRecorderReturn {
//     isRecording: boolean;
//     startRecording: () => Promise<void>;
//     stopRecording: () => void;
//     error: string | null;
// }

// // Hook definition with typed parameters
// export function useAudioRecorder(
//     audioContext: AudioContext | null,
//     onDataAvailable: (pcmBuffer: ArrayBuffer) => void,
//     targetSampleRate: number
// ): UseAudioRecorderReturn {
//     const [isRecording, setIsRecording] = useState<boolean>(false);
//     const [error, setError] = useState<string | null>(null);
//     const streamRef = useRef<MediaStream | null>(null);
//     const audioProcessingNodes = useRef<AudioNodes | null>(null);
//     const onDataAvailableRef = useRef(onDataAvailable); // Store callback

//     // Keep callback ref updated
//     useEffect(() => {
//         onDataAvailableRef.current = onDataAvailable;
//     }, [onDataAvailable]);

//     // Memoized cleanup function
//     const stopAudioNodes = useCallback(() => {
//         if (streamRef.current) {
//             streamRef.current.getTracks().forEach(t => t.stop());
//             streamRef.current = null;
//         }
//         try {
//             if (audioProcessingNodes.current?.processorNode) {
//                 audioProcessingNodes.current.processorNode.onaudioprocess = null; // Remove listener first!
//                 audioProcessingNodes.current.processorNode.disconnect();
//             }
//             if (audioProcessingNodes.current?.sourceNode) {
//                 audioProcessingNodes.current.sourceNode.disconnect();
//             }
//         } catch (de) {
//             console.error("[useAudioRecorder] Disconnect error:", de);
//         }
//         audioProcessingNodes.current = null; // Clear the ref
//     }, []); // No dependencies needed

//     const startRecording = useCallback(async (): Promise<void> => {
//         if (isRecording) {
//             console.warn('[useAudioRecorder] Already recording.');
//             return;
//         }
//         if (!audioContext || audioContext.state !== 'running') {
//             console.error('[useAudioRecorder] AudioContext not available or not running.');
//             setError('Audio system not ready.');
//             setIsRecording(false); // Ensure state is false if context fails
//             return;
//         }

//         setError(null);
//         // Set state before async operation, revert on failure
//         setIsRecording(true);

//         try {
//             console.log('[useAudioRecorder] Requesting microphone access...');
//             const stream: MediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
//             streamRef.current = stream;
//             console.log('[useAudioRecorder] Microphone access granted.');

//             const sourceNodeMic: MediaStreamAudioSourceNode = audioContext.createMediaStreamSource(stream);
//             if (!audioContext.createScriptProcessor) {
//                  console.error("ScriptProcessorNode is not supported.");
//                  throw new Error("ScriptProcessorNode is not supported");
//             }
//             const processorNode: ScriptProcessorNode = audioContext.createScriptProcessor(4096, 1, 1);
//             const inputSampleRate: number = audioContext.sampleRate;
//             console.log(`[useAudioRecorder] Mic SR: ${inputSampleRate}, Target SR: ${targetSampleRate}`);

//             // Inside useAudioRecorder.ts

//             processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
//                 if (!isRecording) return;

//                 try {
//                     const inputData: Float32Array = e.inputBuffer.getChannelData(0);
//                     const downsampledData: Float32Array = downsampleBuffer(inputData, inputSampleRate, targetSampleRate);
//                     const pcm16Data: Int16Array = floatTo16BitPCM(downsampledData);
//                     const pcmBuffer = pcm16Data.buffer; // Get the ArrayBuffer

//                     // *** ADD LOG HERE ***
//                     // console.log(`[useAudioRecorder] onaudioprocess: Processed ${pcmBuffer.byteLength} bytes. About to call onDataAvailableRef.current.`);

//                     if (onDataAvailableRef.current) {
//                         // *** CONFIRM THE CALL ***
//                         onDataAvailableRef.current(pcmBuffer);
//                     } else {
//                         // *** LOG IF HANDLER MISSING ***
//                         console.warn('[useAudioRecorder] onaudioprocess: onDataAvailableRef.current is null or undefined!');
//                     }
//                 } catch (pe) {
//                     console.error("[useAudioRecorder] Processing Error:", pe);
//                     setError(`Audio processing failed: ${pe instanceof Error ? pe.message : String(pe)}`);
//                     stopAudioNodes();
//                     setIsRecording(false);
//                 }
//             };

//             sourceNodeMic.connect(processorNode);
//             processorNode.connect(audioContext.destination);
//             audioProcessingNodes.current = { sourceNode: sourceNodeMic, processorNode: processorNode };
//             console.log('[useAudioRecorder] Recording started.');

//         } catch (err) {
//             console.error('[useAudioRecorder] Start Recording Error:', err);
//              let userMessage = `Recording start failed: ${err instanceof Error ? err.message : String(err)}`;
//              if (err instanceof Error) {
//                  if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
//                      userMessage = 'Microphone access denied. Please allow access and refresh.';
//                  } else if (err.name === 'NotFoundError') {
//                       userMessage = 'No microphone found.';
//                  }
//              }
//             setError(userMessage);
//             setIsRecording(false); // Revert state on error
//             stopAudioNodes(); // Ensure cleanup
//         }
//     }, [isRecording, audioContext, targetSampleRate, stopAudioNodes]); // Added stopAudioNodes dependency

//     const stopRecording = useCallback(() => {
//         if (!isRecording) {
//             // console.log('[useAudioRecorder] Not recording.');
//             return;
//         }
//         console.log('[useAudioRecorder] Stopping recording...');
//         setIsRecording(false); // Set state first
//         stopAudioNodes(); // Then perform cleanup
//         console.log('[useAudioRecorder] Recording stopped.');
//     }, [isRecording, stopAudioNodes]); // Added isRecording dependency

//     // Cleanup effect for unmount
//     useEffect(() => {
//         return () => {
//             console.log("[useAudioRecorder] Cleaning up on unmount...");
//              // Ensure recording is stopped if component unmounts while recording
//              if (isRecording) {
//                 stopAudioNodes();
//              }
//         };
//     }, [isRecording, stopAudioNodes]); // Add isRecording dependency


//     return {
//         isRecording,
//         startRecording,
//         stopRecording,
//         error
//     };
// }
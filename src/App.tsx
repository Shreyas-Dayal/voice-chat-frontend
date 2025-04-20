import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// --- Constants ---
const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8080';
const TARGET_SAMPLE_RATE = 16000; // For mic input processing & playback of received PCM16

// --- WAV Header Function ---
function addWavHeader(pcmData, sampleRate, numChannels, bytesPerSample) {
    const dataSize = pcmData.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize); // 44 bytes for header
    const view = new DataView(buffer);
    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true); // little-endian
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // 16 for PCM format chunk
    view.setUint16(20, 1, true); // 1 for PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
    view.setUint16(32, numChannels * bytesPerSample, true); // block align
    view.setUint16(34, bytesPerSample * 8, true); // bits per sample
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    const pcmView = new Uint8Array(pcmData);
    const dataView = new Uint8Array(buffer, 44);
    dataView.set(pcmView);
    return buffer;
}


// --- Audio Processing Utilities (Input) ---
function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
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
function floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    } return output;
}


function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isAIReady, setIsAIReady] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isAISpeaking, setIsAISpeaking] = useState(false);
    const [statusMessage, setStatusMessage] = useState('Idle');
    const [transcript, setTranscript] = useState('');
    const [currentUtterance, setCurrentUtterance] = useState('');

    const ws = useRef<WebSocket | null>(null);
    // Use a more descriptive name for the ref holding node references
    const audioProcessingNodes = useRef<{ sourceNode: MediaStreamAudioSourceNode | null, processorNode: ScriptProcessorNode | null } | null>(null);
    const audioContext = useRef<AudioContext | null>(null);
    const currentResponseAudioBuffer = useRef<ArrayBuffer[]>([]); // Stores ArrayBuffers for the response being received
    const sourceNode = useRef<AudioBufferSourceNode | null>(null); // Currently playing Web Audio source
    const streamRef = useRef<MediaStream | null>(null); // MediaStream from mic

    const isRecordingRef = useRef(isRecording);
    const didAttemptInitialConnect = useRef(false);

    useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

    // Initial Connection Effect
    useEffect(() => {
        if (!didAttemptInitialConnect.current) {
            console.log("Attempting initial WebSocket connection...");
            connectWebSocket();
            didAttemptInitialConnect.current = true;
            const cleanupCheck = () => { if (ws.current === null || (ws.current && ws.current.readyState !== WebSocket.OPEN && ws.current.readyState !== WebSocket.CONNECTING)) { console.log("Resetting initial connect flag."); didAttemptInitialConnect.current = false; }};
            return cleanupCheck;
        }
        return () => {
            console.log("Cleanup: Stopping/Closing...");
             if (isRecordingRef.current) {
                stopRecording(); // Use the function to ensure proper cleanup
            }
            if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
                console.log(`Cleanup: Closing WebSocket (state: ${ws.current.readyState})`);
                ws.current.close(1000, "Component unmounting");
            }
            ws.current = null;
            if (audioContext.current && audioContext.current.state !== 'closed') {
                console.log("Cleanup: Closing AudioContext.");
                audioContext.current.close().catch(e => console.error("Error closing AC:", e));
            }
            audioContext.current = null;
        };
    }, []); // Empty dependency array

    const updateStatus = (message: string) => { console.log("Status:", message); setStatusMessage(message); };

    // --- Playback Function (Plays a single complete buffer) ---
    const playConcatenatedAudio = useCallback((fullAudioBuffer: ArrayBuffer | null) => {
        if (isAISpeaking) {
            console.warn("Already speaking, cannot start new playback immediately.");
            return;
        }
         if (!fullAudioBuffer || fullAudioBuffer.byteLength === 0) {
             console.warn("Attempted to play empty concatenated audio buffer.");
             return;
         }

        setIsAISpeaking(true);
        updateStatus('AI Speaking...');

        if (!audioContext.current || audioContext.current.state !== 'running') {
            console.error("AudioContext not ready for playback. State:", audioContext.current?.state);
             if(audioContext.current?.state === 'suspended') {
                audioContext.current.resume().then(() => {
                    console.log("Resumed AC for playback.");
                    setIsAISpeaking(false); // Allow retry now context is ready
                    // Debounce or add delay before retry? For now, just allow retry.
                    // requestAnimationFrame(() => playConcatenatedAudio(fullAudioBuffer)); // Could cause loop
                }).catch(e => { console.error("Failed to resume AC:", e); setIsAISpeaking(false); });
             } else { setIsAISpeaking(false); }
             return;
        }

        try {
            // --- ADD WAV HEADER to the *concatenated* buffer ---
            const wavBuffer = addWavHeader(fullAudioBuffer, TARGET_SAMPLE_RATE, 1, 2); // 16kHz, Mono, 16-bit PCM
            // --- END ADD WAV HEADER ---

            audioContext.current.decodeAudioData(wavBuffer)
                .then(decodedData => {
                    if (!audioContext.current) { console.warn("AC closed before playback."); setIsAISpeaking(false); return; }
                    // Stop previous source if it exists and is playing?
                    if (sourceNode.current) {
                        try { sourceNode.current.stop(); } catch(e) {/* ignore if already stopped */}
                        try { sourceNode.current.disconnect(); } catch(e) {/* ignore */}
                        sourceNode.current = null;
                    }

                    sourceNode.current = audioContext.current.createBufferSource();
                    sourceNode.current.buffer = decodedData;
                    sourceNode.current.connect(audioContext.current.destination);
                    sourceNode.current.onended = () => {
                        console.log("Concatenated audio finished playing.");
                        setIsAISpeaking(false);
                        sourceNode.current = null; // Clear completed source node
                        // No need to check queue anymore
                        updateStatus(isAIReady ? 'AI Ready' : 'Connecting...'); // Reset status
                    };
                    sourceNode.current.start(0);
                })
                .catch(error => {
                    console.error('Error decoding concatenated WAV audio data:', error);
                    console.error(`Failed WAV buffer length: ${wavBuffer?.byteLength}, Original PCM length: ${fullAudioBuffer?.byteLength}`);
                    setIsAISpeaking(false);
                    updateStatus("Error playing audio");
                });
        } catch (headerError) {
             console.error("Error adding WAV header:", headerError);
             setIsAISpeaking(false);
             updateStatus("Error preparing audio");
        }

    }, [isAISpeaking, isAIReady]); // Dependencies


    // --- WebSocket Connection ---
    const connectWebSocket = () => {
        if (ws.current && ws.current.readyState !== WebSocket.CLOSED && ws.current.readyState !== WebSocket.CLOSING) {
             console.log(`WebSocket already exists in state ${ws.current.readyState}.`);
             return;
        }
        updateStatus('Connecting to backend...');
        ws.current = new WebSocket(BACKEND_WS_URL);
        ws.current.binaryType = "arraybuffer";

        ws.current.onopen = () => {
            console.log('WS connected.');
            setIsConnected(true);
            updateStatus('Connected. Waiting for AI...');
        };
        ws.current.onclose = (event) => {
            console.log('WS disconnected:', event.code, event.reason);
            setIsConnected(false);
            setIsAIReady(false);
            if (isRecordingRef.current) { setIsRecording(false); } // Sync state if recording
            ws.current = null; // Clear ref
            updateStatus(`Disconnected: ${event.reason || 'Connection closed'}`);
        };
        ws.current.onerror = (error) => {
            console.error('WS error:', error);
            updateStatus('Connection error');
            // Consider closing the WebSocket manually here if it's not already closing
            if(ws.current && ws.current.readyState !== WebSocket.CLOSING && ws.current.readyState !== WebSocket.CLOSED) {
                 ws.current.close();
            }
        };
        ws.current.onmessage = (event: MessageEvent) => {
            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    switch (message.type) {
                        case 'event': handleServerEvent(message.name, message); break;
                        case 'textDelta': if (message.text) { setCurrentUtterance(prev => prev + message.text); } break;
                        case 'error': console.error("Backend Error:", message.message); updateStatus(`Error: ${message.message}`); break;
                        default: console.warn("Unknown JSON type:", message.type);
                    }
                } catch (e) { console.error("Bad JSON:", event.data, e); }
            } else if (event.data instanceof ArrayBuffer) { // PCM16 chunk
                const arrayBuffer = event.data;
                 if (arrayBuffer.byteLength > 0) {
                    // Buffer chunks for the current response
                    currentResponseAudioBuffer.current.push(arrayBuffer);
                } else { console.warn("Empty ArrayBuffer received."); }
            } else { console.warn("Unexpected WS data type:", typeof event.data); }
        };
    };

    // --- Event Handler ---
    const handleServerEvent = (eventName: string, data: any) => {
        console.log("Server Event:", eventName, data || '');
        switch (eventName) {
            case 'AIConnected': setIsAIReady(true); updateStatus('AI Ready'); break;
            case 'AIResponseStart':
                setCurrentUtterance('');
                updateStatus('AI Thinking...');
                currentResponseAudioBuffer.current = []; // Clear buffer for new response
                // Stop any previous playback
                if (sourceNode.current) {
                    try { sourceNode.current.stop(); } catch(e) {/* ignore */}
                    try { sourceNode.current.disconnect(); } catch(e) {/* ignore */}
                    sourceNode.current = null;
                    setIsAISpeaking(false);
                }
                break;
             case 'AISpeechDetected': updateStatus('Hearing you...'); break;
             case 'AISpeechEnded': updateStatus('Processing your speech...'); break;
            case 'AIResponseEnd':
                const finalAiText = data?.finalText || '';
                updateStatus('AI Finished Speaking');
                 if (finalAiText) { setTranscript(prev => prev + `AI: ${finalAiText}\n`); }
                 else if (currentUtterance) { console.warn("No final text, using fallback."); setTranscript(prev => prev + `AI: ${currentUtterance}\n`); }
                 else { console.warn("No final text, no fallback."); setTranscript(prev => prev + `AI: [Audio Response Only]\n`); }
                 setCurrentUtterance('');

                // --- CONCATENATE AND PLAY ALL AUDIO ---
                if (currentResponseAudioBuffer.current.length > 0) {
                     try {
                        const totalLength = currentResponseAudioBuffer.current.reduce((sum, buffer) => sum + buffer.byteLength, 0);
                        console.log(`Concatenating ${currentResponseAudioBuffer.current.length} audio chunks, total size: ${totalLength} bytes`);
                        const concatenatedBuffer = new ArrayBuffer(totalLength);
                        const concatenatedView = new Uint8Array(concatenatedBuffer);
                        let offset = 0;
                        for (const chunk of currentResponseAudioBuffer.current) {
                            concatenatedView.set(new Uint8Array(chunk), offset);
                            offset += chunk.byteLength;
                        }
                        currentResponseAudioBuffer.current = []; // Clear buffer
                        playConcatenatedAudio(concatenatedBuffer); // Play the full audio
                     } catch (concatError) {
                          console.error("Error concatenating audio buffers:", concatError);
                          updateStatus("Error preparing audio");
                           currentResponseAudioBuffer.current = []; // Clear buffer on error
                     }
                } else {
                     console.log("AIResponseEnd received, but no audio chunks were buffered.");
                     if (isAISpeaking) { setIsAISpeaking(false); } // Ensure state reset
                     updateStatus(isAIReady ? 'AI Ready' : 'Connecting...'); // Reset status
                }
                break;
            default: console.log(`Unhandled server event: ${eventName}`);
        }
    };

    // --- Audio Recording ---
    const startRecording = async () => {
        if (isRecordingRef.current || !isAIReady) { return; }
        // Ensure AudioContext is ready
        if (!audioContext.current || audioContext.current.state !== 'running') {
            try {
                 if (!audioContext.current || audioContext.current.state === 'closed') {
                    console.log("Initializing AudioContext for recording...");
                    audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
                 }
                 if (audioContext.current.state === 'suspended') {
                    console.log("Resuming suspended AudioContext for recording...");
                    await audioContext.current.resume();
                 }
                 if (audioContext.current.state !== 'running') { throw new Error(`AC failed. State: ${audioContext.current.state}`); }
                 console.log("AC ready. Req SR:", TARGET_SAMPLE_RATE, "Actual SR:", audioContext.current.sampleRate);
            } catch (e) { console.error("Error init AC:", e); updateStatus("Error: Audio system failed"); return; }
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const sourceNodeMic = audioContext.current.createMediaStreamSource(stream);
            // Check if ScriptProcessorNode is available, provide fallback or warning
            if (!audioContext.current.createScriptProcessor) {
                 alert("ScriptProcessorNode is not supported in this browser. AudioWorklet implementation needed.");
                 throw new Error("ScriptProcessorNode not supported");
            }
            const processorNode = audioContext.current.createScriptProcessor(4096, 1, 1);
            const inputSampleRate = audioContext.current.sampleRate;
            console.log(`Mic source SR: ${inputSampleRate}`);

            processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
                if (!isRecordingRef.current) { return; }
                try {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const downsampledData = downsampleBuffer(inputData, inputSampleRate, TARGET_SAMPLE_RATE);
                    const pcm16Data = floatTo16BitPCM(downsampledData);
                    if (ws.current?.readyState === WebSocket.OPEN) {
                        ws.current.send(pcm16Data.buffer);
                    } else {
                         // Maybe stop recording if WS closes mid-stream?
                         console.warn(`WS closed during recording. Stopping. State=${ws.current?.readyState}`);
                         stopRecording(); // Auto-stop if WS disconnects
                    }
                } catch (pe) {
                    console.error("Proc Error:", pe);
                    stopRecording(); // Stop on processing error
                }
            };

             sourceNodeMic.connect(processorNode);
             processorNode.connect(audioContext.current.destination);
             audioProcessingNodes.current = { sourceNode: sourceNodeMic, processorNode: processorNode };
             setIsRecording(true); updateStatus('Recording...'); setTranscript(prev => prev + "You: (Speaking...)\n");
        } catch (error) {
             setIsRecording(false); console.error('Start Rec Error:', error); updateStatus(`Error: ${error.message}`);
             if ((error as Error).name === 'NotAllowedError') { alert('Mic access denied.'); }
             else { alert(`Rec start fail: ${(error as Error).message}`); }
             streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
        }
    };

    // --- Stop Recording ---
    const stopRecording = () => {
        if (!isRecordingRef.current) { // Check ref first
            console.log("Stop called but not recording.");
            return;
        }
        console.log("Stopping recording...");
        setIsRecording(false); // Update state -> updates ref via useEffect
        updateStatus('Stopping recording...');

        if (streamRef.current) {
            console.log("Stopping tracks...");
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }

        try {
            // Use the specific ref for audio nodes
            if (audioProcessingNodes.current?.processorNode) {
                console.log("Disconnecting proc...");
                audioProcessingNodes.current.processorNode.onaudioprocess = null; // Remove listener
                audioProcessingNodes.current.processorNode.disconnect();
            }
            if (audioProcessingNodes.current?.sourceNode) {
                 console.log("Disconnecting src...");
                 audioProcessingNodes.current.sourceNode.disconnect();
            }
        } catch (de) { console.error("Disconnect err:", de); }

        audioProcessingNodes.current = null; // Clear the ref for nodes
        updateStatus('Processing speech...');
    };


    // --- Render ---
    return (
        <div className="App">
            <h1>OpenAI Realtime Voice Chat</h1>
            <div className="status">
                <p>Status: {statusMessage}</p>
                <p>Backend: {isConnected ? 'Connected' : 'Disconnected'}</p>
                <p>AI: {isAIReady ? 'Ready' : 'Not Ready'}</p>
                <p>Mic: {isRecording ? 'RECORDING' : 'Idle'}</p>
                <p>Speaker: {isAISpeaking ? 'PLAYING' : 'Idle'}</p>
            </div>
            <div className="controls">
                {!isConnected && (
                    <button onClick={connectWebSocket} disabled={ws.current?.readyState === WebSocket.CONNECTING}>Connect</button>
                )}
                {isConnected && isAIReady && !isRecording && (
                    <button onClick={startRecording} disabled={!isAIReady || isAISpeaking}>Start Talking</button>
                )}
                {isRecording && (
                    <button onClick={stopRecording} className="stop-button">Stop Talking</button>
                )}
            </div>
            <div className="transcript-container">
                <h2>Conversation</h2>
                <pre className="transcript">{transcript}</pre>
                {currentUtterance && (<p className="current-utterance"><em>AI: {currentUtterance}</em></p>)}
            </div>
        </div>
    );
}

export default App;


// import React, { useState, useEffect, useRef, useCallback } from 'react';
// import './App.css'; // We'll add some basic CSS

// // --- Constants ---
// // Get backend URL from environment variable or default
// const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8080';
// const TARGET_SAMPLE_RATE = 16000; // Must match backend's expected INPUT_AUDIO_FORMAT sample_rate (pcm16 implies 16k)

// // --- NEW: WAV Header Function ---
// function addWavHeader(pcmData, sampleRate, numChannels, bytesPerSample) {
//     const dataSize = pcmData.byteLength;
//     const buffer = new ArrayBuffer(44 + dataSize); // 44 bytes for header
//     const view = new DataView(buffer);

//     // RIFF identifier ("RIFF")
//     writeString(view, 0, 'RIFF');
//     // RIFF chunk size (36 + dataSize)
//     view.setUint32(4, 36 + dataSize, true); // true for little-endian
//     // RIFF type ("WAVE")
//     writeString(view, 8, 'WAVE');
//     // format chunk identifier ("fmt ")
//     writeString(view, 12, 'fmt ');
//     // format chunk length (16 for PCM)
//     view.setUint32(16, 16, true);
//     // sample format (1 for PCM)
//     view.setUint16(20, 1, true);
//     // channel count
//     view.setUint16(22, numChannels, true);
//     // sample rate
//     view.setUint32(24, sampleRate, true);
//     // byte rate (sample rate * block align)
//     view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
//     // block align (channel count * bytes per sample)
//     view.setUint16(32, numChannels * bytesPerSample, true);
//     // bits per sample
//     view.setUint16(34, bytesPerSample * 8, true);
//     // data chunk identifier ("data")
//     writeString(view, 36, 'data');
//     // data chunk size
//     view.setUint32(40, dataSize, true);

//     // Write the PCM samples to the view - create a new Uint8Array view for the PCM data
//     const pcmView = new Uint8Array(pcmData);
//     // Create a new Uint8Array view for the data portion of the WAV buffer
//     const dataView = new Uint8Array(buffer, 44);
//     // Copy the PCM data into the WAV buffer's data section
//     dataView.set(pcmView);

//     return buffer; // Return the ArrayBuffer with the header + data
// }

// // Helper for writing strings to DataView
// function writeString(view, offset, string) {
//     for (let i = 0; i < string.length; i++) {
//         view.setUint8(offset + i, string.charCodeAt(i));
//     }
// }


// // --- Audio Processing Utilities ---
// // Function to downsample audio buffer
// function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
//     if (inputSampleRate === outputSampleRate) {
//         return buffer;
//     }
//     const sampleRateRatio = inputSampleRate / outputSampleRate;
//     const newLength = Math.round(buffer.length / sampleRateRatio);
//     const result = new Float32Array(newLength);
//     let offsetResult = 0;
//     let offsetBuffer = 0;
//     while (offsetResult < result.length) {
//         const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
//         let accum = 0;
//         let count = 0;
//         for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
//             accum += buffer[i];
//             count++;
//         }
//         // Avoid division by zero if count is 0
//         result[offsetResult] = count > 0 ? accum / count : 0;
//         offsetResult++;
//         offsetBuffer = nextOffsetBuffer;
//     }
//     return result;
// }

// // Function to convert Float32Array to Int16Array (PCM16)
// function floatTo16BitPCM(input) {
//     const output = new Int16Array(input.length);
//     for (let i = 0; i < input.length; i++) {
//         const s = Math.max(-1, Math.min(1, input[i]));
//         output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
//     }
//     return output;
// }


// function App() {
//     const [isConnected, setIsConnected] = useState(false);
//     const [isAIReady, setIsAIReady] = useState(false);
//     const [isRecording, setIsRecording] = useState(false);
//     const [isAISpeaking, setIsAISpeaking] = useState(false);
//     const [statusMessage, setStatusMessage] = useState('Idle');
//     const [transcript, setTranscript] = useState('');
//     const [currentUtterance, setCurrentUtterance] = useState('');

//     const ws = useRef(null);
//     const mediaRecorder = useRef(null); // To hold ScriptProcessorNode refs + stream
//     const audioContext = useRef(null);
//     const audioQueue = useRef([]); // Queue for incoming audio buffers (raw PCM ArrayBuffers)
//     const sourceNode = useRef(null); // To track the current playing Web Audio source
//     const streamRef = useRef(null); // To keep track of the MediaStream

//     // Ref for isRecording state to use in async callbacks
//     const isRecordingRef = useRef(isRecording);
//     const didAttemptInitialConnect = useRef(false);

//     // Keep the ref in sync with the state
//     useEffect(() => {
//         isRecordingRef.current = isRecording;
//     }, [isRecording]);

//     // --- Effect for initial connection ---
//     useEffect(() => {
//         // Only attempt connection once on mount/remount cycle (for StrictMode)
//         if (!didAttemptInitialConnect.current) {
//             console.log("Attempting initial WebSocket connection...");
//             connectWebSocket();
//             didAttemptInitialConnect.current = true; // Mark as attempted

//             // Set flag back to false on cleanup ONLY IF connection didn't establish
//             const cleanupCheck = () => {
//                 if (ws.current === null || (ws.current && ws.current.readyState !== WebSocket.OPEN && ws.current.readyState !== WebSocket.CONNECTING)) {
//                     console.log("Resetting initial connect flag as connection didn't establish.");
//                     didAttemptInitialConnect.current = false;
//                 }
//             };
//             // Return the check function; it will run if the effect re-runs quickly
//             return cleanupCheck;
//         }

//         // Separate cleanup logic that ALWAYS runs on unmount
//         return () => {
//             console.log("Cleanup: Stopping recording and potentially closing WebSocket/AudioContext.");
//             // Ensure recording stops using the LATEST state via ref
//              if (isRecordingRef.current) {
//                 stopRecording();
//             }

//             // Only close WebSocket if it exists and is open or connecting
//             if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
//                 console.log(`Cleanup: Closing WebSocket (state: ${ws.current.readyState})`);
//                 ws.current.close(1000, "Component unmounting");
//             } else if (ws.current) {
//                 console.log(`Cleanup: Not closing WebSocket (state: ${ws.current.readyState})`);
//             }
//             ws.current = null; // Always clear ref on unmount

//             // Close AudioContext only if it was successfully created and not already closed
//             if (audioContext.current && audioContext.current.state !== 'closed') {
//                 console.log("Cleanup: Closing AudioContext.");
//                 audioContext.current.close().catch(e => console.error("Error closing AudioContext:", e));
//             }
//             audioContext.current = null; // Clear ref
//         };
//     }, []); // Empty dependency array


//     const updateStatus = (message) => {
//         console.log("Status:", message);
//         setStatusMessage(message);
//     };

//     // --- Function to handle playback of queued audio ---
//     const playNextAudioChunk = useCallback(() => {
//         if (audioQueue.current.length > 0 && !isAISpeaking) {
//             setIsAISpeaking(true);
//             updateStatus('AI Speaking...');
//             const rawPcmBuffer = audioQueue.current.shift(); // Get the raw PCM ArrayBuffer

//             if (!audioContext.current || audioContext.current.state !== 'running') {
//                  console.error("AudioContext not ready for playback. State:", audioContext.current?.state);
//                  // Attempt to resume if suspended
//                  if(audioContext.current?.state === 'suspended') {
//                     audioContext.current.resume().then(() => {
//                         console.log("Resumed AudioContext for playback.");
//                         // Put buffer back and retry
//                         if (rawPcmBuffer) audioQueue.current.unshift(rawPcmBuffer);
//                         setIsAISpeaking(false); // Allow retry
//                         requestAnimationFrame(playNextAudioChunk);
//                     }).catch(e => {
//                          console.error("Failed to resume AudioContext for playback:", e);
//                          setIsAISpeaking(false); // Stop trying if resume fails
//                     });
//                  } else {
//                     setIsAISpeaking(false); // Stop trying if context is closed or null
//                  }
//                  return;
//             }
//             if (!rawPcmBuffer || rawPcmBuffer.byteLength === 0) {
//                  console.warn("Skipping empty audio buffer in queue.");
//                  setIsAISpeaking(false);
//                  requestAnimationFrame(playNextAudioChunk); // Check next
//                  return;
//             }

//             try {
//                 // --- *** ADD WAV HEADER *** ---
//                 // Assuming OpenAI sends PCM16 (2 bytes per sample), Mono (1 channel) at TARGET_SAMPLE_RATE
//                 const wavBuffer = addWavHeader(rawPcmBuffer, TARGET_SAMPLE_RATE, 1, 2); // 16000, 1 channel, 2 bytes/sample
//                 // --- *** END ADD WAV HEADER *** ---

//                 // Decode the WAV buffer
//                 audioContext.current.decodeAudioData(wavBuffer) // Decode the buffer *with* header
//                     .then(decodedData => {
//                          if (!audioContext.current) { // Check again, context might close during async decode
//                             console.warn("AudioContext closed before playback could start.");
//                             setIsAISpeaking(false);
//                             return;
//                          }
//                          sourceNode.current = audioContext.current.createBufferSource();
//                          sourceNode.current.buffer = decodedData;
//                          sourceNode.current.connect(audioContext.current.destination);
//                          sourceNode.current.onended = () => {
//                              console.log("Audio chunk finished playing.");
//                              setIsAISpeaking(false);
//                              sourceNode.current = null; // Clear completed source node
//                              requestAnimationFrame(playNextAudioChunk); // Check next
//                          };
//                          sourceNode.current.start(0);
//                     })
//                     .catch(error => {
//                         console.error('Error decoding WAV audio data:', error);
//                         // Log details about the buffer for debugging
//                         console.error(`Failed buffer length: ${wavBuffer?.byteLength}, Original PCM length: ${rawPcmBuffer?.byteLength}`);
//                         setIsAISpeaking(false);
//                         requestAnimationFrame(playNextAudioChunk); // Try next
//                     });

//             } catch (headerError) {
//                  console.error("Error adding WAV header:", headerError);
//                  setIsAISpeaking(false);
//                  requestAnimationFrame(playNextAudioChunk); // Try next even if header fails
//             }

//         } else if (audioQueue.current.length === 0 && isAISpeaking) {
//              // Fallback in case onended doesn't fire or race condition
//              console.log("Playback queue empty, ensuring isAISpeaking is false.");
//              setIsAISpeaking(false);
//              updateStatus(isAIReady ? 'AI Ready' : 'Connecting...'); // Update status based on AI readiness
//         }
//     }, [isAISpeaking, isAIReady]); // Added isAIReady dependency for status update


//     // --- WebSocket Connection ---
//     const connectWebSocket = () => {
//         // Prevent multiple connections
//         if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
//             console.log("WebSocket already connecting or open.");
//             return;
//         }

//         updateStatus('Connecting to backend...');
//         ws.current = new WebSocket(BACKEND_WS_URL);
//         ws.current.binaryType = "arraybuffer"; // Important for receiving audio

//         ws.current.onopen = () => {
//             console.log('WebSocket connected to backend.');
//             setIsConnected(true);
//             updateStatus('Connected to backend. Waiting for AI...');
//         };

//         ws.current.onclose = (event) => {
//             console.log('WebSocket disconnected:', event.code, event.reason);
//             setIsConnected(false);
//             setIsAIReady(false);
//              // Check ref before setting state to avoid triggering stopRecording unnecessarily
//             if (isRecordingRef.current) {
//                  setIsRecording(false); // Update state if we were recording
//             }
//             ws.current = null;
//              // No need to call stopRecording here, state change handles it via ref sync effect
//             updateStatus(`Disconnected: ${event.reason || 'Connection closed'}`);
//         };

//         ws.current.onerror = (error) => {
//             console.error('WebSocket error:', error);
//             updateStatus('Connection error');
//             // Don't assume connection state here, let onclose handle it
//         };

//         ws.current.onmessage = (event) => {
//             if (typeof event.data === 'string') {
//                 // Handle JSON messages (control, text)
//                 try {
//                     const message = JSON.parse(event.data);
//                     // console.log("Received JSON message:", message); // Debug
//                     switch (message.type) {
//                         case 'event':
//                             handleServerEvent(message.name, message);
//                             break;
//                         // --- *** HANDLE textDelta *** ---
//                         case 'textDelta':
//                             if (message.text) {
//                                 setCurrentUtterance(prev => prev + message.text);
//                             }
//                             break;
//                         // --- *** END HANDLE textDelta *** ---
//                         case 'error': // Backend forwarding an error
//                              console.error("Error from backend:", message.message);
//                              updateStatus(`Error: ${message.message}`);
//                              break;
//                         default:
//                             console.warn("Received unknown JSON message type:", message.type);
//                     }
//                 } catch (e) {
//                     console.error("Failed to parse JSON message:", event.data, e);
//                 }
//             } else if (event.data instanceof ArrayBuffer) {
//                 // Handle Binary messages (audio) - directly queue ArrayBuffer
//                 const arrayBuffer = event.data;
//                  if (arrayBuffer.byteLength > 0) {
//                     audioQueue.current.push(arrayBuffer); // Queue the RAW PCM ArrayBuffer
//                     if (!isAISpeaking) {
//                        requestAnimationFrame(playNextAudioChunk);
//                     }
//                 } else {
//                     console.warn("Received empty ArrayBuffer.");
//                 }
//             } else {
//                 console.warn("Received unexpected message data type:", typeof event.data, event.data);
//             }
//         };
//     };

//     // --- Event Handler ---
//     const handleServerEvent = (eventName, data) => {
//         console.log("Server Event:", eventName, data || '');
//         switch (eventName) {
//             case 'AIConnected':
//                 setIsAIReady(true);
//                 updateStatus('AI Ready');
//                 break;
//             case 'AIResponseStart':
//                 setCurrentUtterance(''); // Clear previous AI utterance display
//                 updateStatus('AI Thinking...');
//                 break;
//              case 'AISpeechDetected': // OpenAI detected user speech
//                  updateStatus('Hearing you...');
//                  break;
//              case 'AISpeechEnded': // OpenAI detected user speech ended
//                 updateStatus('Processing your speech...');
//                  // VAD handles turns, frontend might not need to do much here
//                  break;
//             case 'AIResponseEnd':
//                 // --- *** USE FINAL TEXT *** ---
//                 const finalAiText = data?.finalText || ''; // Get text from event data
//                 updateStatus('AI Finished Speaking');
//                  // Add the completed utterance (if any) to the transcript
//                  if (finalAiText) {
//                      setTranscript(prev => prev + `AI: ${finalAiText}\n`);
//                  } else if (currentUtterance) {
//                      // Fallback to using the streamed utterance if finalText extraction failed but we streamed something
//                       console.warn("AIResponseEnd received no final text, using streamed utterance as fallback.");
//                      setTranscript(prev => prev + `AI: ${currentUtterance}\n`);
//                  } else {
//                      console.warn("AIResponseEnd received no final text and no streamed text available.");
//                       setTranscript(prev => prev + `AI: [Audio Response Only]\n`); // Indicate audio if no text
//                  }
//                  setCurrentUtterance(''); // Clear streamed text buffer
//                  // --- *** END USE FINAL TEXT *** ---
//                  // Reset speaking state just in case onended didn't fire
//                  if (isAISpeaking) {
//                     setIsAISpeaking(false);
//                  }
//                  // Play any remaining queued audio (should be minimal after response end)
//                  requestAnimationFrame(playNextAudioChunk);
//                 break;
//             default:
//                 console.log(`Unhandled server event: ${eventName}`);
//         }
//     };

//     // --- Audio Recording ---
//     const startRecording = async () => {
//          // Use ref for the most up-to-date check
//         if (isRecordingRef.current || !isAIReady) {
//             console.log("Cannot start recording. Already recording or AI not ready.");
//             return;
//         }

//         // Initialize/resume AudioContext if needed (essential before getUserMedia often)
//         if (!audioContext.current || audioContext.current.state !== 'running') {
//             try {
//                 // Create or resume AudioContext
//                  if (!audioContext.current || audioContext.current.state === 'closed') {
//                     console.log("Initializing AudioContext for recording...");
//                     // --- TRY ADDING sampleRate HINT ---
//                     audioContext.current = new (window.AudioContext || window.webkitAudioContext)({
//                          sampleRate: TARGET_SAMPLE_RATE
//                     });
//                  }
//                  if (audioContext.current.state === 'suspended') {
//                     console.log("Resuming suspended AudioContext for recording...");
//                     await audioContext.current.resume();
//                  }
//                  if (audioContext.current.state !== 'running') {
//                      throw new Error(`AudioContext failed to start/resume. State: ${audioContext.current.state}`);
//                  }
//                  console.log("AudioContext ready. Requested SR:", TARGET_SAMPLE_RATE, "Actual SR:", audioContext.current.sampleRate); // Log both
//             } catch (e) {
//                 console.error("Error initializing/resuming AudioContext for recording:", e);
//                 updateStatus("Error: Audio system failed");
//                 return;
//             }
//         }


//         try {
//             // Request microphone access
//             const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//             streamRef.current = stream; // Store stream to stop tracks later

//             // Create audio nodes using the existing AudioContext
//             const sourceNodeMic = audioContext.current.createMediaStreamSource(stream);
//             const processorNode = audioContext.current.createScriptProcessor(4096, 1, 1); // Buffer size, input channels, output channels

//             const inputSampleRate = audioContext.current.sampleRate;
//             console.log(`Mic source sample rate: ${inputSampleRate}`);

//             processorNode.onaudioprocess = (audioProcessingEvent) => {
//                 // --- CHECK THE REF INSTEAD OF STATE ---
//                 if (!isRecordingRef.current) { // <--- Use the ref here!
//                     return; // Exit if recording has stopped
//                 }

//                 // --- REST OF THE PROCESSING ---
//                 // console.log("onaudioprocess fired. isRecordingRef:", isRecordingRef.current); // Noisy log

//                 try { // Add try/catch around processing
//                     const inputBuffer = audioProcessingEvent.inputBuffer;
//                     const inputData = inputBuffer.getChannelData(0); // Get Float32 data

//                     // 1. Downsample if necessary
//                     const downsampledData = downsampleBuffer(inputData, inputSampleRate, TARGET_SAMPLE_RATE);

//                     // 2. Convert to PCM16
//                     const pcm16Data = floatTo16BitPCM(downsampledData);

//                     // 3. Send the Int16Array's buffer over WebSocket
//                     if (ws.current && ws.current.readyState === WebSocket.OPEN) {
//                         // console.log(`SENDING Audio Chunk: Size=${pcm16Data.buffer.byteLength} bytes, WS State=${ws.current.readyState}`);
//                         ws.current.send(pcm16Data.buffer); // Send the underlying ArrayBuffer
//                     } else {
//                         console.warn(`SKIPPING Audio Send during recording: WS State=${ws.current?.readyState}`);
//                     }
//                 } catch (processingError) {
//                     console.error("Error during audio processing in onaudioprocess:", processingError);
//                     // Consider stopping recording if processing fails repeatedly
//                     stopRecording();
//                 }
//             };

//              // Connect the nodes: Mic -> Processor -> Destination
//              // Connecting to destination is necessary for onaudioprocess to fire.
//              // It does NOT mean the audio plays through speakers unless you want it to.
//              sourceNodeMic.connect(processorNode);
//              processorNode.connect(audioContext.current.destination);


//              // Store references to the nodes for cleanup
//              mediaRecorder.current = { // Use a simple object to hold nodes
//                 sourceNode: sourceNodeMic,
//                 processorNode: processorNode
//              };

//             // --- Update state ---
//             setIsRecording(true);
//             updateStatus('Recording...');
//             setTranscript(prev => prev + "You: (Speaking...)\n"); // Indicate user turn start

//         } catch (error) {
//              // --- Update state on error ---
//             setIsRecording(false); // Ensure state is false on error
//              console.error('Error starting recording:', error);
//              updateStatus(`Error: ${error.message}`);
//              if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
//                 alert('Microphone access denied. Please allow microphone access in your browser settings.');
//              } else {
//                  alert(`Could not start recording: ${error.message}`);
//              }
//              // Clean up stream if already acquired
//              streamRef.current?.getTracks().forEach(track => track.stop());
//              streamRef.current = null;
//         }
//     };

//     // --- Stop Recording ---
//     const stopRecording = () => {
//         // Check the ref for the most accurate current state
//         if (!isRecordingRef.current || !mediaRecorder.current) {
//             console.log("Stop recording called but not recording or recorder nodes not ready.");
//             // Ensure state consistency if called unexpectedly
//              if (isRecording) setIsRecording(false); // Update state if it's somehow still true
//             // Attempt cleanup if refs exist unexpectedly
//             streamRef.current?.getTracks().forEach(track => track.stop());
//             streamRef.current = null;
//             mediaRecorder.current = null;
//             return;
//         }

//         console.log("Stopping recording...");
//         // Update state first - this triggers the useEffect to update the ref
//         setIsRecording(false);
//         updateStatus('Stopping recording...');

//         // 1. Stop the MediaStream tracks (stops mic input)
//         if (streamRef.current) {
//             console.log("Stopping MediaStream tracks...");
//             streamRef.current.getTracks().forEach(track => track.stop());
//             streamRef.current = null; // Clear the ref
//         } else {
//              console.warn("streamRef was null during stopRecording");
//         }

//         // 2. Disconnect the audio nodes AFTER stopping tracks
//         try {
//             if (mediaRecorder.current.processorNode) {
//                 console.log("Disconnecting processor node...");
//                 // Remove the event handler *before* disconnecting
//                 mediaRecorder.current.processorNode.onaudioprocess = null;
//                 mediaRecorder.current.processorNode.disconnect();
//             }
//             if (mediaRecorder.current.sourceNode) {
//                  console.log("Disconnecting source node...");
//                  mediaRecorder.current.sourceNode.disconnect();
//             }
//         } catch (disconnectError) {
//              console.error("Error disconnecting audio nodes:", disconnectError);
//         }

//         // 3. Clear the mediaRecorder ref LAST
//         mediaRecorder.current = null;

//         updateStatus('Processing speech...'); // Let user know backend is working
//     };


//     // Effect for handling audio queue changes triggered by isAISpeaking
//     useEffect(() => {
//         // This effect ensures playback continues if chunks arrive while not speaking
//         if (!isAISpeaking && audioQueue.current.length > 0) {
//             requestAnimationFrame(playNextAudioChunk);
//         }
//     }, [isAISpeaking, playNextAudioChunk]);


//     return (
//         <div className="App">
//             <h1>OpenAI Realtime Voice Chat</h1>
//             <div className="status">
//                 <p>Status: {statusMessage}</p>
//                 <p>Backend: {isConnected ? 'Connected' : 'Disconnected'}</p>
//                 <p>AI: {isAIReady ? 'Ready' : 'Not Ready'}</p>
//                 <p>Mic: {isRecording ? 'RECORDING' : 'Idle'}</p>
//                 <p>Speaker: {isAISpeaking ? 'PLAYING' : 'Idle'}</p>
//             </div>

//             <div className="controls">
//                 {!isConnected && (
//                     <button onClick={connectWebSocket} disabled={ws.current && ws.current.readyState === WebSocket.CONNECTING}>Connect</button>
//                 )}
//                 {isConnected && isAIReady && !isRecording && (
//                     <button onClick={startRecording} disabled={!isAIReady || isAISpeaking}>
//                         Start Talking
//                     </button>
//                 )}
//                 {isRecording && (
//                     <button onClick={stopRecording} className="stop-button">
//                         Stop Talking
//                     </button>
//                 )}
//             </div>

//             <div className="transcript-container">
//                 <h2>Conversation</h2>
//                 <pre className="transcript">{transcript}</pre>
//                 {currentUtterance && (
//                     <p className="current-utterance"><em>AI: {currentUtterance}</em></p>
//                 )}
//             </div>
//         </div>
//     );
// }

// export default App;


// ////////////////////////////////////////////////////////////////////////////

// // import React, { useState, useEffect, useRef, useCallback } from 'react';
// // import './App.css'; // We'll add some basic CSS

// // // --- Constants ---
// // // Get backend URL from environment variable or default
// // const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8080';
// // const TARGET_SAMPLE_RATE = 16000; // Must match backend's expected INPUT_AUDIO_FORMAT sample_rate
// // const AUDIO_TIMESLICE_MS = 250; // Send audio chunks every 250ms



// // // --- Audio Processing Utilities ---
// // // Function to downsample audio buffer
// // function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
// //     if (inputSampleRate === outputSampleRate) {
// //         return buffer;
// //     }
// //     const sampleRateRatio = inputSampleRate / outputSampleRate;
// //     const newLength = Math.round(buffer.length / sampleRateRatio);
// //     const result = new Float32Array(newLength);
// //     let offsetResult = 0;
// //     let offsetBuffer = 0;
// //     while (offsetResult < result.length) {
// //         const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
// //         let accum = 0;
// //         let count = 0;
// //         for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
// //             accum += buffer[i];
// //             count++;
// //         }
// //         result[offsetResult] = accum / count;
// //         offsetResult++;
// //         offsetBuffer = nextOffsetBuffer;
// //     }
// //     return result;
// // }

// // // Function to convert Float32Array to Int16Array (PCM16)
// // function floatTo16BitPCM(input) {
// //     const output = new Int16Array(input.length);
// //     for (let i = 0; i < input.length; i++) {
// //         const s = Math.max(-1, Math.min(1, input[i]));
// //         output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
// //     }
// //     return output;
// // }


// // function App() {
// //     const [isConnected, setIsConnected] = useState(false);
// //     const [isAIReady, setIsAIReady] = useState(false);
// //     const [isRecording, setIsRecording] = useState(false);
// //     const [isAISpeaking, setIsAISpeaking] = useState(false);
// //     const [statusMessage, setStatusMessage] = useState('Idle');
// //     const [transcript, setTranscript] = useState('');
// //     const [currentUtterance, setCurrentUtterance] = useState('');

// //     const ws = useRef(null);
// //     const mediaRecorder = useRef(null);
// //     const audioContext = useRef(null);
// //     const audioQueue = useRef([]); // Queue for incoming audio buffers
// //     const sourceNode = useRef(null); // To track the current playing node
// //     const streamRef = useRef(null); // To keep track of the media stream

// //     // Add this ref at the top of your App component
// //     const didAttemptInitialConnect = useRef(false);
    
// //     // --- ADD THIS REF ---
// //     const isRecordingRef = useRef(isRecording);

// //     // --- ADD THIS EFFECT ---
// //     // Keep the ref in sync with the state
// //     useEffect(() => {
// //         isRecordingRef.current = isRecording;
// //     }, [isRecording]);

// //     // --- Effect for initial connection ---
// //     useEffect(() => {
// //         // Only attempt connection once on mount/remount cycle
// //         if (!didAttemptInitialConnect.current) {
// //             console.log("Attempting initial WebSocket connection...");
// //             connectWebSocket();
// //             didAttemptInitialConnect.current = true; // Mark as attempted

// //             // Set flag back to false on cleanup ONLY IF connection didn't establish
// //             // This allows the next mount in StrictMode to retry if the first failed quickly
// //             return () => {
// //                 if (ws.current === null || (ws.current && ws.current.readyState !== WebSocket.OPEN && ws.current.readyState !== WebSocket.CONNECTING)) {
// //                     console.log("Resetting initial connect flag as connection didn't establish.");
// //                     didAttemptInitialConnect.current = false;
// //                 }
// //             }
// //         }


// //         // Separate cleanup logic that ALWAYS runs
// //         return () => {
// //             console.log("Cleanup: Stopping recording and potentially closing WebSocket/AudioContext.");
// //             stopRecording(); // Ensure recording stops

// //             // Only close WebSocket if it exists and is open or connecting
// //             if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
// //                 console.log(`Cleanup: Closing WebSocket (state: ${ws.current.readyState})`);
// //                 ws.current.close(1000, "Component unmounting");
// //             } else if (ws.current) {
// //                 console.log(`Cleanup: Not closing WebSocket (state: ${ws.current.readyState})`);
// //             }
// //             ws.current = null; // Always clear ref on unmount

// //             // Close AudioContext only if it was successfully created and not already closed
// //             if (audioContext.current && audioContext.current.state !== 'closed') {
// //                 console.log("Cleanup: Closing AudioContext.");
// //                 audioContext.current.close().catch(e => console.error("Error closing AudioContext:", e)); // Add catch
// //             }
// //             audioContext.current = null; // Clear ref
// //         };
// //     }, []); // Empty dependency array


// //     const updateStatus = (message) => {
// //         console.log("Status:", message);
// //         setStatusMessage(message);
// //     };

// //     // Function to handle playback of queued audio
// //     const playNextAudioChunk = useCallback(() => {
// //         if (audioQueue.current.length > 0 && !isAISpeaking) {
// //             setIsAISpeaking(true);
// //             updateStatus('AI Speaking...');
// //             const buffer = audioQueue.current.shift(); // Get the next chunk

// //             if (!audioContext.current) {
// //                 console.error("AudioContext not initialized!");
// //                 setIsAISpeaking(false);
// //                 return;
// //             }

// //             // Decode and play
// //             audioContext.current.decodeAudioData(buffer.buffer) // Need ArrayBuffer
// //                 .then(decodedData => {
// //                     sourceNode.current = audioContext.current.createBufferSource();
// //                     sourceNode.current.buffer = decodedData;
// //                     sourceNode.current.connect(audioContext.current.destination);
// //                     sourceNode.current.onended = () => {
// //                         console.log("Audio chunk finished playing.");
// //                         setIsAISpeaking(false);
// //                         // Immediately check if there's more audio to play
// //                         // Use requestAnimationFrame for smoother transitions
// //                         requestAnimationFrame(playNextAudioChunk);
// //                     };
// //                     sourceNode.current.start(0);
// //                 })
// //                 .catch(error => {
// //                     console.error('Error decoding audio data:', error);
// //                     setIsAISpeaking(false);
// //                     // Try playing the next chunk even if this one failed
// //                      requestAnimationFrame(playNextAudioChunk);
// //                 });
// //         } else if (audioQueue.current.length === 0 && isAISpeaking) {
// //             // This case should ideally be handled by onended, but as a fallback:
// //              console.log("Playback queue empty, ensuring isAISpeaking is false.");
// //              setIsAISpeaking(false);
// //              updateStatus(isAIReady ? 'AI Ready' : 'Connecting...');
// //         }
// //     }, [isAISpeaking]); // Dependency ensures correct state access

// //     // --- WebSocket Connection ---
// //     const connectWebSocket = () => {
// //         if (ws.current && ws.current.readyState === WebSocket.OPEN) {
// //             console.log("WebSocket already connected.");
// //             return;
// //         }

// //         updateStatus('Connecting to backend...');
// //         ws.current = new WebSocket(BACKEND_WS_URL);

// //         ws.current.onopen = () => {
// //             console.log('WebSocket connected to backend.');
// //             setIsConnected(true);
// //             updateStatus('Connected to backend. Waiting for AI...');
// //         };

// //         ws.current.onclose = (event) => {
// //             console.log('WebSocket disconnected:', event.code, event.reason);
// //             setIsConnected(false);
// //             setIsAIReady(false);
// //             setIsRecording(false);
// //             ws.current = null;
// //             stopRecording(); // Ensure recording stops if connection drops
// //             updateStatus(`Disconnected: ${event.reason || 'Connection closed'}`);
// //         };

// //         ws.current.onerror = (error) => {
// //             console.error('WebSocket error:', error);
// //             updateStatus('Connection error');
// //             setIsConnected(false);
// //             setIsAIReady(false);
// //             setIsRecording(false);
// //              // Attempt to close cleanly, might already be closed
// //             ws.current?.close();
// //             ws.current = null;
// //             stopRecording();
// //         };

// //         ws.current.onmessage = (event) => {
// //             if (typeof event.data === 'string') {
// //                 // Handle JSON messages (control, text)
// //                 try {
// //                     const message = JSON.parse(event.data);
// //                     // console.log("Received JSON message:", message); // Debug
// //                     switch (message.type) {
// //                         case 'event':
// //                             handleServerEvent(message.name, message);
// //                             break;
// //                         case 'textDelta':
// //                             setCurrentUtterance(prev => prev + message.text);
// //                             break;
// //                         case 'error': // Backend forwarding an error
// //                              console.error("Error from backend:", message.message);
// //                              updateStatus(`Error: ${message.message}`);
// //                              break;
// //                         default:
// //                             console.warn("Received unknown JSON message type:", message.type);
// //                     }
// //                 } catch (e) {
// //                     console.error("Failed to parse JSON message:", event.data, e);
// //                 }
// //             } else if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
// //                  // Handle Binary messages (audio)
// //                  // Convert Blob to ArrayBuffer if necessary
// //                 const processAudio = (arrayBuffer) => {
// //                     // console.log(`Received audio chunk: ${arrayBuffer.byteLength} bytes`); // Debug
// //                     if (arrayBuffer.byteLength > 0) {
// //                         audioQueue.current.push(arrayBuffer);
// //                         // Start playback if not already playing
// //                         if (!isAISpeaking) {
// //                            requestAnimationFrame(playNextAudioChunk);
// //                         }
// //                     }
// //                 };

// //                 if (event.data instanceof Blob) {
// //                     event.data.arrayBuffer().then(processAudio);
// //                 } else {
// //                     processAudio(event.data);
// //                 }
// //             } else {
// //                 console.warn("Received unexpected message data type:", event.data);
// //             }
// //         };
// //     };

// //     const handleServerEvent = (eventName, data) => {
// //         console.log("Server Event:", eventName, data || '');
// //         switch (eventName) {
// //             case 'AIConnected':
// //                 setIsAIReady(true);
// //                 updateStatus('AI Ready');
// //                 break;
// //             case 'AIResponseStart':
// //                 setCurrentUtterance(''); // Clear previous AI utterance
// //                 updateStatus('AI Thinking...');
// //                 break;
// //              case 'AISpeechDetected': // OpenAI detected user speech
// //                  updateStatus('Hearing you...');
// //                  break;
// //              case 'AISpeechEnded': // OpenAI detected user speech ended
// //                 updateStatus('Processing your speech...');
// //                  // VAD handles turns, frontend might not need to do much here
// //                  break;
// //             case 'AIResponseEnd':
// //                 updateStatus('AI Finished Speaking');
// //                  // Add the completed utterance to the transcript
// //                  setTranscript(prev => prev + (currentUtterance ? `AI: ${currentUtterance}\n` : ''));
// //                  setCurrentUtterance(''); // Clear for next turn
// //                  // Reset speaking state just in case onended didn't fire
// //                  if (isAISpeaking) {
// //                     setIsAISpeaking(false);
// //                  }
// //                  // Play any remaining queued audio (should be minimal)
// //                  requestAnimationFrame(playNextAudioChunk);
// //                 break;
// //             default:
// //                 console.log(`Unhandled server event: ${eventName}`);
// //         }
// //     };

// //     // --- Audio Recording ---
// //     const startRecording = async () => {
// //         if (isRecording || !isAIReady) {
// //             console.log("Cannot start recording. Recording active or AI not ready.");
// //             return;
// //         }

// //         // Initialize AudioContext if not already done (requires user interaction)
// //         if (!audioContext.current) {
// //             try {
// //                 audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
// //                  // Check if context is running, resume if suspended
// //                 if (audioContext.current.state === 'suspended') {
// //                     await audioContext.current.resume();
// //                 }
// //                  console.log("AudioContext initialized/resumed. Sample Rate:", audioContext.current.sampleRate);
// //             } catch (e) {
// //                 console.error("Error initializing AudioContext:", e);
// //                 updateStatus("Error: AudioContext failed");
// //                 return;
// //             }
// //         } else if (audioContext.current.state === 'suspended') {
// //              await audioContext.current.resume();
// //              console.log("AudioContext resumed.");
// //         }


// //         try {
// //             const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
// //             streamRef.current = stream; // Store stream to stop tracks later
// //             const sourceNodeMic = audioContext.current.createMediaStreamSource(stream);
// //             const processorNode = audioContext.current.createScriptProcessor(4096, 1, 1); // Buffer size, input channels, output channels

// //             const inputSampleRate = audioContext.current.sampleRate;
// //             console.log(`Mic source sample rate: ${inputSampleRate}`);

// //             // Modify the onaudioprocess handler
// //             processorNode.onaudioprocess = (audioProcessingEvent) => {
// //                 // --- CHECK THE REF INSTEAD OF STATE ---
// //                 if (!isRecordingRef.current) { // <--- Use the ref here!
// //                     return; // Exit if recording has stopped
// //                 }

// //                 // --- REST OF THE PROCESSING ---
// //                 // console.log("onaudioprocess fired. isRecordingRef:", isRecordingRef.current); // Can use this log now

// //                 const inputBuffer = audioProcessingEvent.inputBuffer;
// //                 const inputData = inputBuffer.getChannelData(0);
// //                 const downsampledData = downsampleBuffer(inputData, inputSampleRate, TARGET_SAMPLE_RATE);
// //                 const pcm16Data = floatTo16BitPCM(downsampledData);

// //                 if (ws.current && ws.current.readyState === WebSocket.OPEN) {
// //                      try {
// //                         // console.log(`SENDING Audio Chunk: Size=${pcm16Data.buffer.byteLength} bytes, WS State=${ws.current.readyState}`);
// //                         ws.current.send(pcm16Data.buffer);
// //                      } catch (e) {
// //                         console.error("Error sending audio data:", e);
// //                      }
// //                 } else {
// //                     console.warn(`SKIPPING Audio Send during recording: WS State=${ws.current?.readyState}`);
// //                 }
// //             };

// //              // Connect the nodes: Mic -> Processor -> Destination (optional, avoids echo if muted)
// //              sourceNodeMic.connect(processorNode);
// //              processorNode.connect(audioContext.current.destination); // Connect to output to allow processing
// //               // MUTE the processor node output IF you don't want mic feedback through speakers
// //              // processorNode.disconnect(audioContext.current.destination);


// //              mediaRecorder.current = { // Use a simple object to track state and nodes
// //                 state: 'recording',
// //                 stream: stream,
// //                 sourceNode: sourceNodeMic,
// //                 processorNode: processorNode
// //              };

// //             // --- Update state AND ref ---
// //             setIsRecording(true);
// //             // isRecordingRef.current = true; // (The useEffect above handles this)
// //             updateStatus('Recording...');
// //             setTranscript(prev => prev + "You: (Speaking...)\n");

// //         } catch (error) {
// //             // --- Update state AND ref on error ---
// //             setIsRecording(false); // Ensure state is false on error
// //             // isRecordingRef.current = false; // (The useEffect above handles this)
// //             console.error('Error starting recording:', error);
// //             updateStatus(`Error: ${error.message}`);
// //             if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
// //                 alert('Microphone access denied. Please allow microphone access in your browser settings.');
// //             } else {
// //                  alert(`Could not start recording: ${error.message}`);
// //             }
// //         }
// //     };

// //     const stopRecording = () => {
// //          // --- Check the REF here too for consistency ---
// //         if (!isRecordingRef.current || !mediaRecorder.current) { // <--- Use the ref here!
// //             console.log("Stop recording called but not recording or recorder not ready.");
// //             // Ensure state consistency even if called unexpectedly
// //             setIsRecording(false); // Update state
// //             // isRecordingRef.current = false; // (The useEffect above handles this)
// //             // Attempt cleanup if refs exist unexpectedly
// //             streamRef.current?.getTracks().forEach(track => track.stop());
// //             streamRef.current = null;
// //             mediaRecorder.current = null;
// //             return;
// //         }

// //         console.log("Stopping recording...");
// //         // --- Update state AND ref ---
// //         setIsRecording(false);
// //         // isRecordingRef.current = false; // (The useEffect above handles this)
// //         updateStatus('Stopping recording...');

// //         // 1. Stop the MediaStream tracks (stops mic input)
// //         if (streamRef.current) {
// //             console.log("Stopping MediaStream tracks...");
// //             streamRef.current.getTracks().forEach(track => track.stop());
// //             streamRef.current = null; // Clear the ref
// //         } else {
// //              console.warn("streamRef was null during stopRecording");
// //         }

// //         // 2. Disconnect the audio nodes AFTER stopping tracks
// //         // This might allow any already-queued onaudioprocess events to finish? (Hypothesis)
// //         if (mediaRecorder.current.processorNode) {
// //             console.log("Disconnecting processor node...");
// //             mediaRecorder.current.processorNode.disconnect();
// //         }
// //         if (mediaRecorder.current.sourceNode) {
// //              console.log("Disconnecting source node...");
// //              mediaRecorder.current.sourceNode.disconnect();
// //         }

// //         // 3. Clear the mediaRecorder ref LAST
// //         mediaRecorder.current = null;

// //         updateStatus('Processing speech...');
// //     };

// //     // --- Effect for initial connection ---
// //     useEffect(() => {
// //         connectWebSocket();
// //         // Cleanup on unmount
// //         return () => {
// //             stopRecording(); // Ensure recording stops
// //             ws.current?.close();
// //              if (audioContext.current && audioContext.current.state !== 'closed') {
// //                 audioContext.current.close();
// //                 audioContext.current = null;
// //              }
// //         };
// //     }, []); // Empty dependency array ensures this runs only once on mount

// //     // Effect for handling audio queue changes triggered by isAISpeaking
// //     useEffect(() => {
// //         if (!isAISpeaking && audioQueue.current.length > 0) {
// //             requestAnimationFrame(playNextAudioChunk);
// //         }
// //     }, [isAISpeaking, playNextAudioChunk]);


// //     return (
// //         <div className="App">
// //             <h1>OpenAI Realtime Voice Chat</h1>
// //             <div className="status">
// //                 <p>Status: {statusMessage}</p>
// //                 <p>Backend: {isConnected ? 'Connected' : 'Disconnected'}</p>
// //                 <p>AI: {isAIReady ? 'Ready' : 'Not Ready'}</p>
// //                 <p>Mic: {isRecording ? 'RECORDING' : 'Idle'}</p>
// //                 <p>Speaker: {isAISpeaking ? 'PLAYING' : 'Idle'}</p>
// //             </div>

// //             <div className="controls">
// //                 {!isConnected && (
// //                     <button onClick={connectWebSocket}>Connect</button>
// //                 )}
// //                 {isConnected && isAIReady && !isRecording && (
// //                     <button onClick={startRecording} disabled={!isAIReady || isAISpeaking}>
// //                         Start Talking
// //                     </button>
// //                 )}
// //                 {isRecording && (
// //                     <button onClick={stopRecording} className="stop-button">
// //                         Stop Talking
// //                     </button>
// //                 )}
// //             </div>

// //             <div className="transcript-container">
// //                 <h2>Conversation</h2>
// //                 <pre className="transcript">{transcript}</pre>
// //                 {currentUtterance && (
// //                     <p className="current-utterance"><em>AI: {currentUtterance}</em></p>
// //                 )}
// //             </div>
// //         </div>
// //     );
// // }

// // export default App;

// // // // src/App.tsx
// // // import { useState, useEffect, useRef, useCallback } from 'react';
// // // import './App.css';

// // // // --- Configuration ---
// // // const WEBSOCKET_URL = 'ws://localhost:8080'; // Your Backend WebSocket URL
// // // const TIMESLICE_MS = 250; // Send audio chunks frequently for lower latency
// // // const REQUEST_SAMPLE_RATE = 16000; // Target sample rate for microphone (Backend MUST match)
// // // const AUDIO_MIME_TYPES = [ // Prioritize Opus for efficiency
// // //     'audio/opus;codecs=opus',
// // //     'audio/webm;codecs=opus',
// // //     // Fallback (less ideal, ensure backend encoding matches if used)
// // //     // 'audio/wav',
// // // ];

// // // // --- Interfaces ---
// // // interface ChatMessage {
// // //     id: string;
// // //     origin: 'user_transcript' | 'system' | 'ai_transcript'; // Transcript origins
// // //     text: string; // Text is now primary content
// // //     isFinal?: boolean; // Track final vs interim transcripts
// // //     timestamp: Date;
// // // }

// // // // --- Custom Hook for Audio Playback ---
// // // function useAudioPlayback(onPlaybackError: (message: string) => void) {
// // //     const audioContextRef = useRef<AudioContext | null>(null);
// // //     const audioQueueRef = useRef<ArrayBuffer[]>([]);
// // //     const isPlayingRef = useRef(false);
// // //     const [isSpeaking, setIsSpeaking] = useState(false); // Public state for UI

// // //     const initializeAudioContext = useCallback(async (): Promise<boolean> => {
// // //         if (audioContextRef.current && audioContextRef.current.state === 'running') {
// // //             return true; // Already initialized and running
// // //         }
// // //         try {
// // //             // Attempt to resume existing context if suspended
// // //             if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
// // //                 await audioContextRef.current.resume();
// // //                 console.log("Resumed existing AudioContext. State:", audioContextRef.current.state);
// // //                 return true;
// // //             }
// // //             // Create new context if none exists or if closed
// // //             if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
// // //                  console.log("Initializing new AudioContext...");
// // //                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
// // //                  audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
// // //                      sampleRate: 24000 // Suggest output rate, browser might adjust
// // //                  });
// // //                  // Wait for it to be running (might require user gesture sometimes)
// // //                  if (audioContextRef.current.state === 'suspended') {
// // //                     await audioContextRef.current.resume(); // Often needed
// // //                  }
// // //                  console.log("AudioContext state:", audioContextRef.current.state);
// // //                  if (audioContextRef.current.state !== 'running') {
// // //                      throw new Error(`AudioContext failed to reach running state (${audioContextRef.current.state})`);
// // //                  }
// // //             }
// // //             return true; // Successfully initialized or resumed
// // //         } catch (e) {
// // //             console.error("Error initializing/resuming AudioContext:", e);
// // //             onPlaybackError(`Audio playback system error: ${e instanceof Error ? e.message : String(e)}`);
// // //             audioContextRef.current = null; // Ensure it's null on failure
// // //             return false;
// // //         }
// // //     }, [onPlaybackError]);


// // //     const playNextAudioChunk = useCallback(async () => {
// // //         if (!audioContextRef.current || audioContextRef.current.state !== 'running') {
// // //             console.warn("AudioContext not ready, cannot play.");
// // //             isPlayingRef.current = false;
// // //             setIsSpeaking(false);
// // //             onPlaybackError("Audio system not ready for playback.");
// // //             // Clear queue if context fails? Prevents buildup.
// // //             // audioQueueRef.current = [];
// // //             return;
// // //         }
// // //         if (isPlayingRef.current || audioQueueRef.current.length === 0) {
// // //             if (audioQueueRef.current.length === 0) setIsSpeaking(false);
// // //             return;
// // //         }

// // //         isPlayingRef.current = true;
// // //         setIsSpeaking(true); // Update public state

// // //         const audioData = audioQueueRef.current.shift();
// // //         if (!audioData) { // Safety check
// // //             isPlayingRef.current = false;
// // //             setIsSpeaking(false);
// // //             return;
// // //         }

// // //         try {
// // //             const audioBuffer = await audioContextRef.current.decodeAudioData(audioData.slice(0)); // Use slice(0) for safety?
// // //             const sourceNode = audioContextRef.current.createBufferSource();
// // //             sourceNode.buffer = audioBuffer;
// // //             sourceNode.connect(audioContextRef.current.destination);
// // //             sourceNode.onended = () => {
// // //                 isPlayingRef.current = false;
// // //                 playNextAudioChunk(); // Immediately check for next chunk
// // //             };
// // //             sourceNode.start();
// // //         } catch (error) {
// // //             console.error("Error decoding/playing audio chunk:", error);
// // //             onPlaybackError(`Audio playback failed: ${error instanceof Error ? error.message : String(error)}`);
// // //             isPlayingRef.current = false;
// // //             setIsSpeaking(false);
// // //             playNextAudioChunk(); // Attempt next chunk even on error
// // //         }
// // //     }, [onPlaybackError]); // Add dependency

// // //     const addAudioToQueue = useCallback((audioData: ArrayBuffer) => {
// // //         // Ensure context is ready before adding, initialize if needed
// // //         initializeAudioContext().then(success => {
// // //             if (success) {
// // //                 audioQueueRef.current.push(audioData);
// // //                 if (!isPlayingRef.current) {
// // //                     playNextAudioChunk();
// // //                 }
// // //             } else {
// // //                  console.error("Cannot queue audio, AudioContext failed to initialize.");
// // //                  // Don't queue if context isn't working
// // //             }
// // //         });
// // //     }, [initializeAudioContext, playNextAudioChunk]);

// // //     const cleanupAudio = useCallback(() => {
// // //         console.log("Cleaning up Audio playback resources...");
// // //         // Stop any ongoing playback source node? Difficult to track precisely.
// // //         // Closing context usually handles this.
// // //         audioContextRef.current?.close().catch(console.error);
// // //         audioContextRef.current = null;
// // //         audioQueueRef.current = [];
// // //         isPlayingRef.current = false;
// // //         setIsSpeaking(false);
// // //     }, []);

// // //     return { isSpeaking, addAudioToQueue, initializeAudioContext, cleanupAudio };
// // // }


// // // // --- Main App Component ---
// // // function App() {
// // //     const [isConnecting, setIsConnecting] = useState(false);
// // //     const [isConnected, setIsConnected] = useState(false);
// // //     const [isRecording, setIsRecording] = useState(false);
// // //     const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
// // //     const [statusMessage, setStatusMessage] = useState("Initializing...");
// // //     const [currentMicInfo, setCurrentMicInfo] = useState<string | null>(null);

// // //     const webSocketRef = useRef<WebSocket | null>(null);
// // //     const mediaRecorderRef = useRef<MediaRecorder | null>(null);
// // //     const streamRef = useRef<MediaStream | null>(null);
// // //     const chatWindowRef = useRef<HTMLDivElement>(null);
// // //     const lastInterimAiMsgIdRef = useRef<string | null>(null);

// // //     // Callback for audio playback errors
// // //     const handlePlaybackError = useCallback((message: string) => {
// // //         setStatusMessage(`Playback Error: ${message}`);
// // //         addMessage({ origin: 'system', text: `Audio Playback Error: ${message}` });
// // //     }, []); // Define addMessage below or pass it in

// // //     // Use the custom hook for audio playback
// // //     const { isSpeaking, addAudioToQueue, initializeAudioContext, cleanupAudio } = useAudioPlayback(handlePlaybackError);


// // //     // --- Utility Function for Adding Messages ---
// // //     const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>, replaceInterimId: string | null = null) => {
// // //         const newMessage = { ...message, id: crypto.randomUUID(), timestamp: new Date() };

// // //         setChatMessages(prev => {
// // //             let updatedMessages = [...prev]; // Create a new array for immutability

// // //             // Handle replacement of interim AI messages
// // //             if (replaceInterimId && newMessage.origin === 'ai_transcript' && newMessage.isFinal) {
// // //                 const index = updatedMessages.findIndex(msg => msg.id === replaceInterimId);
// // //                 if (index !== -1) {
// // //                      console.log(`Replacing interim message ${replaceInterimId} with final ${newMessage.id}`);
// // //                      updatedMessages[index] = newMessage; // Replace in place
// // //                      lastInterimAiMsgIdRef.current = null; // Clear ref after final
// // //                 } else {
// // //                     // If interim wasn't found (e.g., cleared by user message), just add final
// // //                      updatedMessages.push(newMessage);
// // //                 }
// // //             }
// // //             // Handle new interim AI messages (remove previous interim first)
// // //             else if (newMessage.origin === 'ai_transcript' && !newMessage.isFinal) {
// // //                  if (lastInterimAiMsgIdRef.current) {
// // //                      // Filter out the previous interim message
// // //                     updatedMessages = updatedMessages.filter(msg => msg.id !== lastInterimAiMsgIdRef.current);
// // //                  }
// // //                  updatedMessages.push(newMessage); // Add the new interim message
// // //                  lastInterimAiMsgIdRef.current = newMessage.id; // Store its ID
// // //             }
// // //             // Handle non-AI messages (clear any pending interim AI ref)
// // //             else if (newMessage.origin !== 'ai_transcript') {
// // //                  lastInterimAiMsgIdRef.current = null;
// // //                  updatedMessages.push(newMessage); // Add the new message
// // //             }
// // //             // Default case: Just add the message (e.g., initial final AI message)
// // //             else {
// // //                  updatedMessages.push(newMessage);
// // //             }

// // //             return updatedMessages;
// // //         });
// // //     }, []); // No dependencies needed as it uses state setters and refs


// // //     // Scroll chat window
// // //     useEffect(() => {
// // //         chatWindowRef.current?.scrollTo({ top: chatWindowRef.current.scrollHeight, behavior: 'smooth' });
// // //     }, [chatMessages]);

// // //     // --- WebSocket Logic ---
// // //     const handleWsOpen = useCallback(() => {
// // //         console.log("Backend WebSocket Connected");
// // //         setIsConnecting(false);
// // //         setIsConnected(true);
// // //         setStatusMessage("Connected. Waiting for AI ready signal..."); // Wait for backend confirmation
// // //         addMessage({ origin: 'system', text: 'Connected to backend.' });
// // //     }, [addMessage]);

// // //     const stopRecordingForce = useCallback((reason: string) => {
// // //         console.warn(`Force stopping recording due to: ${reason}`);
// // //         if (mediaRecorderRef.current?.state === "recording") {
// // //              mediaRecorderRef.current.onstop = null; // Prevent normal onstop logic
// // //              mediaRecorderRef.current.stop();
// // //         }
// // //         setIsRecording(false);
// // //         streamRef.current?.getTracks().forEach(track => track.stop());
// // //         streamRef.current = null;
// // //         mediaRecorderRef.current = null;
// // //         // Reset status appropriately
// // //         if (isConnected) setStatusMessage(`Recording stopped (${reason}). Ready.`);
// // //     }, [isConnected]); // Include dependencies if needed

// // //     const handleWsClose = useCallback((event: CloseEvent) => {
// // //         console.log(`Backend WebSocket Disconnected: Code=${event.code}, Reason=${event.reason}`);
// // //         setIsConnecting(false);
// // //         setIsConnected(false);
// // //         const reason = event.reason || (event.wasClean ? 'Normal closure' : 'Connection lost');
// // //         setStatusMessage(`Disconnected: ${reason}.`);
// // //         addMessage({ origin: 'system', text: `WebSocket disconnected. ${reason}` });
// // //         webSocketRef.current = null;
// // //         if (isRecording) {
// // //             stopRecordingForce("WebSocket closed");
// // //         }
// // //     }, [addMessage, isRecording, stopRecordingForce]);

// // //     const handleWsError = useCallback((event: Event) => {
// // //         console.error("Backend WebSocket Error:", event);
// // //         setIsConnecting(false); // Assume connection failed or will close
// // //         // The 'close' event usually follows, so we might not need to set isConnected=false here
// // //         setStatusMessage("WebSocket connection error.");
// // //         addMessage({ origin: 'system', text: 'WebSocket connection error.' });
// // //         // Don't force stop recording here, wait for close event
// // //     }, [addMessage]);

// // //     const handleWsMessage = useCallback(async (event: MessageEvent) => {
// // //         if (typeof event.data === 'string') {
// // //              try {
// // //                 const data = JSON.parse(event.data);
// // //                 if (data.type === 'transcript' && typeof data.text === 'string') {
// // //                      // Decide origin based on role (assuming backend mirrors OpenAI role)
// // //                      const origin: ChatMessage['origin'] = data.role === 'user' ? 'user_transcript' : 'ai_transcript';
// // //                      addMessage(
// // //                         { origin, text: data.text, isFinal: data.final ?? false }, // Default final to false
// // //                         origin === 'ai_transcript' && data.final ? lastInterimAiMsgIdRef.current : null
// // //                      );
// // //                  } else if (data.type === 'system' && typeof data.message === 'string') {
// // //                      addMessage({ origin: 'system', text: data.message });
// // //                      if (data.message === 'AI connection ready.') {
// // //                         setStatusMessage("AI Ready. You can start recording.");
// // //                      }
// // //                  } else if (data.type === 'error' && typeof data.message === 'string') {
// // //                      console.error("Received error from backend:", data.message);
// // //                      addMessage({ origin: 'system', text: `ERROR: ${data.message}` });
// // //                      setStatusMessage(`Error: ${data.message}`);
// // //                       // Should we stop recording on backend error? Maybe.
// // //                       if (isRecording) {
// // //                           stopRecordingForce(`Backend Error: ${data.message}`);
// // //                       }
// // //                  } else {
// // //                       console.warn("Received unknown text message structure:", data);
// // //                  }
// // //              } catch (e) {
// // //                   console.warn("Received non-JSON string message:", event.data, e);
// // //                   addMessage({ origin: 'system', text: `Unknown text message: ${event.data.substring(0, 100)}... (Error: ${e instanceof Error ? e.message : String(e)})` });
// // //              }
// // //         } else if (event.data instanceof ArrayBuffer) {
// // //             // console.log(`Received ${event.data.byteLength} bytes of audio data.`); // DEBUG
// // //             addAudioToQueue(event.data); // Queue AI audio for playback
// // //         } else {
// // //              console.warn("Received unexpected message type:", typeof event.data);
// // //         }
// // //     }, [addAudioToQueue, addMessage, isRecording, stopRecordingForce]); // Added dependencies

// // //     const connectWebSocket = useCallback(() => {
// // //         if (webSocketRef.current || isConnecting) return;

// // //         console.log(`Attempting to connect WebSocket to ${WEBSOCKET_URL}...`);
// // //         setIsConnecting(true);
// // //         setStatusMessage("Connecting to backend...");
// // //         addMessage({ origin: 'system', text: 'Connecting to backend...' });

// // //         try {
// // //             const ws = new WebSocket(WEBSOCKET_URL);
// // //             ws.binaryType = "arraybuffer";
// // //             ws.onopen = handleWsOpen;
// // //             ws.onclose = handleWsClose;
// // //             ws.onerror = handleWsError;
// // //             ws.onmessage = handleWsMessage;
// // //             webSocketRef.current = ws;
// // //         } catch (error) {
// // //             console.error("Failed to create WebSocket:", error);
// // //             setIsConnecting(false);
// // //             setStatusMessage("Error creating WebSocket.");
// // //             addMessage({ origin: 'system', text: 'Failed to initiate WebSocket connection.' });
// // //         }
// // //     }, [isConnecting, handleWsOpen, handleWsClose, handleWsError, handleWsMessage, addMessage]);

// // //     // --- MediaRecorder Logic ---
// // //     const startRecording = async () => {
// // //         if (isRecording) return;
// // //         if (!isConnected) {
// // //              setStatusMessage("Connect to backend before recording.");
// // //              return;
// // //         }
// // //         // Initialize/resume AudioContext for playback BEFORE starting recording
// // //         // Ensures user interaction gesture covers both mic access and audio playback
// // //         const audioPlaybackReady = await initializeAudioContext();
// // //         if (!audioPlaybackReady) {
// // //              setStatusMessage("Audio playback system failed. Cannot record.");
// // //              return; // Don't proceed if playback isn't ready
// // //         }

// // //         // --- Get Media Stream ---
// // //         let actualSampleRate = 0;
// // //         let actualMimeType = '';
// // //         try {
// // //             if (streamRef.current) { // Clean up previous stream
// // //                 streamRef.current.getTracks().forEach(track => track.stop());
// // //             }
// // //              const constraints: MediaStreamConstraints = { audio: { sampleRate: REQUEST_SAMPLE_RATE } };
// // //             console.log("Requesting microphone access with constraints:", constraints.audio);
// // //             streamRef.current = await navigator.mediaDevices.getUserMedia(constraints);

// // //             // --- Verify Actual Settings ---
// // //             const audioTracks = streamRef.current.getAudioTracks();
// // //             if (audioTracks.length > 0) {
// // //                 const settings = audioTracks[0].getSettings();
// // //                 actualSampleRate = settings.sampleRate || 0;
// // //                 console.log("Actual microphone sample rate:", actualSampleRate);
// // //                 if (actualSampleRate && actualSampleRate !== REQUEST_SAMPLE_RATE) {
// // //                      console.warn(`Sample rate mismatch! Requested ${REQUEST_SAMPLE_RATE}, got ${actualSampleRate}. Ensure backend INPUT_SAMPLE_RATE matches ${actualSampleRate}!`);
// // //                      addMessage({ origin: 'system', text: `Warning: Mic sample rate is ${actualSampleRate}Hz. Backend must match!` });
// // //                  } else if (!actualSampleRate) {
// // //                       console.warn("Could not detect actual sample rate.");
// // //                       addMessage({ origin: 'system', text: `Warning: Cannot detect mic sample rate. Ensure backend matches expected rate (${REQUEST_SAMPLE_RATE}Hz)!` });
// // //                       actualSampleRate = REQUEST_SAMPLE_RATE; // Assume requested rate if detection fails
// // //                  }
// // //             } else {
// // //                  throw new Error("No audio tracks found in the media stream.");
// // //             }

// // //         } catch (error) {
// // //             console.error("Error accessing microphone:", error);
// // //             setStatusMessage("Microphone access failed.");
// // //             addMessage({ origin: 'system', text: `Error accessing microphone: ${error instanceof Error ? error.message : String(error)}` });
// // //             setCurrentMicInfo("Mic Error");
// // //             return;
// // //         }

// // //         // --- Find Supported MIME Type ---
// // //         actualMimeType = AUDIO_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || '';
// // //         if (!actualMimeType) {
// // //              console.error("No supported audio MIME type found (Opus preferred).");
// // //              setStatusMessage("Browser lacks supported audio format.");
// // //              addMessage({ origin: 'system', text: "Error: Browser doesn't support required audio recording formats (Opus preferred)." });
// // //              streamRef.current?.getTracks().forEach(track => track.stop()); // Clean up stream
// // //              streamRef.current = null;
// // //              setCurrentMicInfo(`SR: ${actualSampleRate}Hz / Format: Error`);
// // //              return;
// // //         }
// // //         console.log("Using MIME type for recording:", actualMimeType);
// // //         setCurrentMicInfo(`SR: ${actualSampleRate}Hz / ${actualMimeType.split('/')[1].split(';')[0]}`); // Display format concisely

// // //         // --- Create and Configure MediaRecorder ---
// // //         try {
// // //             const recorder = new MediaRecorder(streamRef.current, { mimeType: actualMimeType });
// // //             mediaRecorderRef.current = recorder;

// // //             recorder.ondataavailable = (event: BlobEvent) => {
// // //                 if (event.data.size > 0 && webSocketRef.current?.readyState === WebSocket.OPEN) {
// // //                     webSocketRef.current.send(event.data); // Send Blob directly
// // //                 } else if (event.data.size > 0) {
// // //                     // This might happen if WS closes exactly between chunks
// // //                     console.warn("MediaRecorder data available, but WebSocket is not open.");
// // //                 }
// // //             };

// // //             recorder.onstop = () => {
// // //                 console.log("MediaRecorder stopped successfully.");
// // //                 // State is managed by the stopRecording function caller
// // //                 // Clean up stream tracks *here* after recorder is fully stopped
// // //                 streamRef.current?.getTracks().forEach(track => track.stop());
// // //                 streamRef.current = null;
// // //                 mediaRecorderRef.current = null; // Clear recorder instance
// // //                  if (isConnected && !isSpeaking) { // Reset status only if connected and AI isn't talking
// // //                      setStatusMessage("Processing complete. Ready to record again.");
// // //                  }
// // //             };

// // //              recorder.onerror = (event) => {
// // //                  console.error("MediaRecorder Error:", event);
// // //                  // Use the force stop mechanism for cleanup
// // //                  stopRecordingForce(`MediaRecorder Error: ${event}`);
// // //                  setStatusMessage("Error during recording.");
// // //                  setCurrentMicInfo("Mic Recorder Error");
// // //                  addMessage({ origin: 'system', text: `Recording Error: ${event}` });
// // //              };

// // //             recorder.start(TIMESLICE_MS);
// // //             setIsRecording(true);
// // //             setStatusMessage("🔴 Recording...");
// // //             addMessage({ origin: 'system', text: 'Recording started...' });

// // //         } catch(error) {
// // //              console.error("Error creating MediaRecorder:", error);
// // //              addMessage({ origin: 'system', text: `Error setting up recorder: ${error instanceof Error ? error.message : String(error)}` });
// // //              setStatusMessage("Failed to start recorder.");
// // //              setCurrentMicInfo("Mic Setup Error");
// // //              streamRef.current?.getTracks().forEach(track => track.stop());
// // //              streamRef.current = null;
// // //              setIsRecording(false); // Ensure recording state is false
// // //         }
// // //     };

// // //     // stopRecording function now uses stopRecordingForce internally for error cases
// // //     const stopRecording = (isForced = false) => {
// // //         if (isForced) {
// // //              stopRecordingForce("Forced stop");
// // //              return;
// // //         }

// // //         if (mediaRecorderRef.current?.state === "recording") {
// // //              setStatusMessage("Stopping recording..."); // Immediate feedback
// // //              if (webSocketRef.current?.readyState === WebSocket.OPEN) {
// // //                  try {
// // //                     console.log("Sending EndOfUserAudio signal to backend");
// // //                     webSocketRef.current.send(JSON.stringify({ type: 'EndOfUserAudio' }));
// // //                     setStatusMessage("Ending stream..."); // Update status after sending signal
// // //                  } catch (e) {
// // //                      console.error("Failed to send EndOfUserAudio signal:", e);
// // //                       setStatusMessage("Error signaling end. Stopping locally.");
// // //                  }
// // //              } else {
// // //                   console.warn("Cannot send EndOfUserAudio signal: WebSocket not open.");
// // //                   setStatusMessage("Stopping recording locally (cannot signal end).");
// // //              }
// // //              // Stop the recorder. The 'onstop' handler will set isRecording=false and clean up.
// // //             mediaRecorderRef.current.stop();
// // //             // Set isRecording false immediately for UI responsiveness?
// // //              // setIsRecording(false); // Or wait for onstop? Waiting might be slightly more accurate.
// // //         } else {
// // //             console.warn("Stop recording called but recorder not active.");
// // //             setIsRecording(false); // Ensure state consistency
// // //         }
// // //     };


// // //     // --- Button Click Handler ---
// // //     const handleToggleRecord = () => {
// // //         if (isRecording) {
// // //             stopRecording();
// // //         } else {
// // //             startRecording();
// // //         }
// // //     };

// // //     // --- Effects ---
// // //     // Connect WebSocket on mount
// // //     useEffect(() => {
// // //         setStatusMessage("Connecting to backend...");
// // //         connectWebSocket();
// // //     }, [connectWebSocket]);

// // //     // Cleanup on unmount
// // //     useEffect(() => {
// // //         return () => {
// // //             console.log("Cleaning up App component on unmount...");
// // //             const currentWebSocket = webSocketRef.current; // Capture ref before clearing
// // //             if (currentWebSocket) {
// // //                 // Remove listeners to prevent updates after unmount
// // //                 currentWebSocket.onopen = null;
// // //                 currentWebSocket.onclose = null;
// // //                 currentWebSocket.onerror = null;
// // //                 currentWebSocket.onmessage = null;
// // //                 if (currentWebSocket.readyState === WebSocket.OPEN || currentWebSocket.readyState === WebSocket.CONNECTING) {
// // //                     currentWebSocket.close(1000, "Component unmounting");
// // //                 }
// // //             }
// // //             if (mediaRecorderRef.current?.state === "recording") {
// // //                 // Remove listeners before stopping to prevent state updates?
// // //                 mediaRecorderRef.current.ondataavailable = null;
// // //                 mediaRecorderRef.current.onerror = null;
// // //                 mediaRecorderRef.current.onstop = null;
// // //                 mediaRecorderRef.current.stop();
// // //             }
// // //             streamRef.current?.getTracks().forEach(track => track.stop());
// // //             cleanupAudio(); // Clean up AudioContext and related refs/state
// // //             // Clear refs manually
// // //             webSocketRef.current = null;
// // //             mediaRecorderRef.current = null;
// // //             streamRef.current = null;
// // //             lastInterimAiMsgIdRef.current = null;
// // //             console.log("App component cleanup complete.");
// // //         };
// // //     }, [cleanupAudio]); // Add cleanupAudio dependency

// // //     // --- Render ---
// // //     return (
// // //         <div className="App">
// // //             <header className="App-header">
// // //                 <h2>Realtime Voice Chat</h2>
// // //                  <div className="connection-info">
// // //                     <span>
// // //                          Backend: <span className={isConnected ? 'connected' : 'disconnected'}>
// // //                              {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
// // //                          </span>
// // //                          {!isConnected && !isConnecting && (
// // //                             <button onClick={connectWebSocket} className="connect-button" disabled={isConnecting}>Retry</button>
// // //                         )}
// // //                     </span>
// // //                      <span className="mic-info">
// // //                          {currentMicInfo || "Mic Status"}
// // //                      </span>
// // //                  </div>
// // //             </header>

// // //             <div className="chat-window" ref={chatWindowRef}>
// // //                 {chatMessages.map((msg) => (
// // //                     <div key={msg.id} className={`message ${msg.origin}`}>
// // //                         <div className="content">
// // //                             {/* Render different content based on origin */}
// // //                             {msg.origin === 'system' && <em className="system-text">{msg.text}</em>}
// // //                             {msg.origin === 'ai_transcript' && <p className={`ai-text ${msg.isFinal ? 'final' : 'interim'}`}>{msg.text}</p>}
// // //                             {msg.origin === 'user_transcript' && <p className={`user-text ${msg.isFinal ? 'final' : 'interim'}`}>{msg.text}</p>}
// // //                         </div>
// // //                          <span className="timestamp">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
// // //                     </div>
// // //                 ))}
// // //                 {/* Speaking indicator can be subtle */}
// // //                 {isSpeaking && <div className="speaking-indicator">🔊</div>}
// // //             </div>

// // //             <footer className="App-footer">
// // //                 <p className="status-line">{statusMessage}</p>
// // //                 <button
// // //                     onClick={handleToggleRecord}
// // //                     disabled={!isConnected || isSpeaking || isConnecting} // Prevent recording if not connected, AI speaking, or connecting
// // //                     className={`record-button ${isRecording ? 'recording' : ''}`}
// // //                     title={!isConnected ? "Connect to backend first" : isSpeaking ? "Wait for AI to finish" : isRecording ? "Stop Recording" : "Start Recording"}
// // //                 >
// // //                     {/* Icon managed by CSS */}
// // //                 </button>
// // //             </footer>
// // //         </div>
// // //     );
// // // }

// // // export default App;
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// --- Constants ---
const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8080';
// Use a consistent sample rate matching OpenAI's PCM16 output and our desired input target
const TARGET_SAMPLE_RATE = 24000;

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

// --- Download Function ---
function downloadData(dataBuffer, filename) {
    try {
        if (!dataBuffer || dataBuffer.byteLength === 0) {
            console.error("Download cancelled: No data to download.");
            alert("No audio data available to download for the last response.");
            return;
        }
        // Add WAV Header before creating Blob
        const wavBuffer = addWavHeader(dataBuffer, TARGET_SAMPLE_RATE, 1, 2);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' }); // Use WAV mime type
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename; // Suggest .wav extension
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        console.log(`Triggered download for ${filename}`);
    } catch (e) {
        console.error("Error triggering download:", e);
        alert(`Failed to trigger download: ${e instanceof Error ? e.message : String(e)}`);
    }
}

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isAIReady, setIsAIReady] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isAISpeaking, setIsAISpeaking] = useState(false);
    const [statusMessage, setStatusMessage] = useState('Idle');
    const [transcript, setTranscript] = useState('');
    const [currentUtterance, setCurrentUtterance] = useState('');
    // State to hold RAW PCM buffer for download
    const [lastRawAudioBuffer, setLastRawAudioBuffer] = useState<ArrayBuffer | null>(null);

    const ws = useRef<WebSocket | null>(null);
    const audioProcessingNodes = useRef<{ sourceNode: MediaStreamAudioSourceNode | null, processorNode: ScriptProcessorNode | null } | null>(null);
    const audioContext = useRef<AudioContext | null>(null);
    // --- RESTORED: Ref for buffering audio chunks for playback ---
    const currentResponseAudioBuffer = useRef<ArrayBuffer[]>([]);
    // --- RESTORED: Ref for the playback source node ---
    const sourceNode = useRef<AudioBufferSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const isRecordingRef = useRef(isRecording);
    const didAttemptInitialConnect = useRef(false);

    useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

    // --- Function to ensure AudioContext is ready ---
    const ensureAudioContext = useCallback(async () => {
        if (audioContext.current && audioContext.current.state === 'running') {
            return true; // Already running
        }
        try {
             if (!audioContext.current || audioContext.current.state === 'closed') {
                console.log("Initializing AudioContext...");
                audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
                console.log(`AudioContext initialized. Requested SR: ${TARGET_SAMPLE_RATE}, Actual SR: ${audioContext.current.sampleRate}`);
             }
             if (audioContext.current.state === 'suspended') {
                console.log("Resuming suspended AudioContext...");
                await audioContext.current.resume();
             }
             if (audioContext.current.state !== 'running') {
                throw new Error(`AC initialization failed. Final State: ${audioContext.current.state}`);
             }
             return true; // Success
        } catch (e) {
            console.error("Error ensuring AudioContext:", e);
            updateStatus(`Error: Audio system failed - ${e.message}`);
            audioContext.current = null; // Reset on error
            return false; // Failure
        }
    }, []);

    // Initial Connection Effect
    useEffect(() => {
        if (!didAttemptInitialConnect.current) {
            console.log("Attempting initial WebSocket connection...");
            connectWebSocket(); // Connect on first load
            didAttemptInitialConnect.current = true;
        }

        // ComponentDidUnmount logic
        return () => {
            console.log("Cleanup: Stopping/Closing...");
            if (isRecordingRef.current) {
                stopRecording();
            }
            if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
                console.log(`Cleanup: Closing WebSocket (state: ${ws.current.readyState})`);
                ws.current.close(1000, "Component unmounting");
            }
            ws.current = null;
            if (audioContext.current && audioContext.current.state !== 'closed') {
                console.log("Cleanup: Closing AudioContext.");
                 // Stop any playing source before closing context
                 if (sourceNode.current) {
                      try { sourceNode.current.stop(); } catch(e) { console.warn("Cleanup stop error:", e)}
                      try { sourceNode.current.disconnect(); } catch(e) { console.warn("Cleanup disconnect error:", e)}
                      sourceNode.current = null;
                 }
                audioContext.current.close().catch(e => console.error("Error closing AC:", e));
            }
            audioContext.current = null;
        };
    }, []); // Empty dependency array means run once on mount, cleanup on unmount

    const updateStatus = (message: string) => { console.log("Status:", message); setStatusMessage(message); };

    // --- RESTORED: Playback Function (Plays a single complete buffer) ---
    const playConcatenatedAudio = useCallback(async (fullAudioBuffer: ArrayBuffer | null) => {
        // Check if already speaking or buffer is empty
        if (isAISpeaking) {
            console.warn("Already speaking, cannot start new playback immediately.");
            return;
        }
        if (!fullAudioBuffer || fullAudioBuffer.byteLength === 0) {
            console.warn("Attempted to play empty/null concatenated audio buffer.");
            return; // Nothing to play
        }

        // Ensure AudioContext is ready before proceeding
        const contextReady = await ensureAudioContext();
        if (!contextReady || !audioContext.current) {
            console.error("AudioContext not ready for playback.");
            updateStatus("Error: Audio playback failed");
            setIsAISpeaking(false); // Ensure state is reset
            return;
        }

        setIsAISpeaking(true);
        updateStatus('AI Speaking...');

        try {
            // Add WAV header to the concatenated buffer
            const wavBuffer = addWavHeader(fullAudioBuffer, TARGET_SAMPLE_RATE, 1, 2); // 24kHz, Mono, 16-bit PCM

            audioContext.current.decodeAudioData(wavBuffer)
                .then(decodedData => {
                    if (!audioContext.current) { console.warn("AC closed before playback could start."); setIsAISpeaking(false); return; }

                    // Stop previous source if it exists (safety check)
                    if (sourceNode.current) {
                        try { sourceNode.current.stop(); } catch(e) {}
                        try { sourceNode.current.disconnect(); } catch(e) {}
                        sourceNode.current = null;
                    }

                    sourceNode.current = audioContext.current.createBufferSource();
                    sourceNode.current.buffer = decodedData;
                    sourceNode.current.connect(audioContext.current.destination);
                    sourceNode.current.onended = () => {
                        console.log("Concatenated audio finished playing.");
                        setIsAISpeaking(false);
                        sourceNode.current = null; // Clear completed source node
                        updateStatus(isAIReady ? 'AI Ready' : 'Connecting...'); // Reset status
                    };
                    sourceNode.current.start(0); // Start playback immediately
                })
                .catch(decodeError => {
                    console.error('Error decoding concatenated WAV audio data:', decodeError);
                    console.error(`Failed WAV buffer length: ${wavBuffer?.byteLength}, Original PCM length: ${fullAudioBuffer?.byteLength}`);
                    setIsAISpeaking(false); // Reset state on error
                    updateStatus("Error playing audio");
                });
        } catch (headerError) {
             console.error("Error adding WAV header:", headerError);
             setIsAISpeaking(false); // Reset state on error
             updateStatus("Error preparing audio");
        }
    }, [isAISpeaking, isAIReady, ensureAudioContext]); // Dependencies

    // --- WebSocket Connection ---
    const connectWebSocket = () => { // No longer async needed here
        if (ws.current && ws.current.readyState !== WebSocket.CLOSED && ws.current.readyState !== WebSocket.CLOSING) {
             console.log(`WebSocket already exists in state ${ws.current.readyState}.`);
             return;
        }
        updateStatus('Connecting to backend...');
        // Attempt to initialize AC early, but don't block connection
        ensureAudioContext();

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
            setIsAISpeaking(false); // Reset speaking state
            if (isRecordingRef.current) { setIsRecording(false); }
            ws.current = null;
            updateStatus(`Disconnected: ${event.reason || 'Connection closed'}`);
        };
        ws.current.onerror = (error) => {
            console.error('WS error:', error);
            updateStatus('Connection error');
            setIsAISpeaking(false); // Reset speaking state
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
            } else if (event.data instanceof ArrayBuffer) {
                // --- RESTORED: Buffer chunks for later playback ---
                const arrayBuffer = event.data;
                if (arrayBuffer.byteLength > 0) {
                    currentResponseAudioBuffer.current.push(arrayBuffer);
                } else { console.warn("Empty ArrayBuffer received."); }
                // --- END RESTORED ---
            } else { console.warn("Unexpected WS data type:", typeof event.data); }
        };
    };

    // --- Event Handler ---
    const handleServerEvent = (eventName: string, data: any) => {
        console.log("Server Event:", eventName, data || '');
        switch (eventName) {
            case 'AIConnected':
                setIsAIReady(true);
                updateStatus('AI Ready');
                break;
            case 'AIResponseStart':
                setCurrentUtterance('');
                updateStatus('AI Thinking...');
                // --- RESTORED: Clear playback buffer ---
                currentResponseAudioBuffer.current = [];
                setLastRawAudioBuffer(null); // Clear previous downloadable buffer
                // --- RESTORED: Stop any previous playback ---
                if (sourceNode.current) {
                    try { sourceNode.current.stop(); } catch(e) {}
                    try { sourceNode.current.disconnect(); } catch(e) {}
                    sourceNode.current = null;
                }
                setIsAISpeaking(false); // Ensure state is reset
                break;
             case 'AISpeechDetected': updateStatus('Hearing you...'); break;
             case 'AISpeechEnded': updateStatus('Processing your speech...'); break;
            case 'AIResponseEnd':
                const finalAiText = data?.finalText || '';
                updateStatus('AI Finished Speaking'); // Update status now play starts after this

                 if (finalAiText) { setTranscript(prev => prev + `AI: ${finalAiText}\n`); }
                 else if (currentUtterance) { console.warn("No final text, using fallback."); setTranscript(prev => prev + `AI: ${currentUtterance}\n`); }
                 else { console.warn("No final text, no fallback."); setTranscript(prev => prev + `AI: [Audio Response Only]\n`); }
                 setCurrentUtterance('');

                // --- RESTORED: Concatenate and Play ---
                if (currentResponseAudioBuffer.current.length > 0) {
                     try {
                        const totalLength = currentResponseAudioBuffer.current.reduce((sum, buffer) => sum + buffer.byteLength, 0);
                        console.log(`Concatenating ${currentResponseAudioBuffer.current.length} audio chunks, total size: ${totalLength} bytes`);
                        const concatenatedPcmBuffer = new ArrayBuffer(totalLength);
                        const concatenatedView = new Uint8Array(concatenatedPcmBuffer);
                        let offset = 0;
                        for (const chunk of currentResponseAudioBuffer.current) {
                            concatenatedView.set(new Uint8Array(chunk), offset);
                            offset += chunk.byteLength;
                        }
                        const bufferToSaveAndPlay = concatenatedPcmBuffer.slice(0); // Create a copy

                        // --- STORE RAW BUFFER FOR DOWNLOAD ---
                        setLastRawAudioBuffer(bufferToSaveAndPlay);

                        // --- PLAY CONCATENATED AUDIO ---
                        playConcatenatedAudio(bufferToSaveAndPlay); // Pass raw PCM copy

                     } catch (concatError) {
                          console.error("Error concatenating audio buffers:", concatError);
                          updateStatus("Error preparing audio");
                           setLastRawAudioBuffer(null);
                     }
                } else {
                     console.log("AIResponseEnd received, but no audio chunks were buffered.");
                     updateStatus(isAIReady ? 'AI Ready' : 'Connecting...'); // Reset status if no audio
                     setLastRawAudioBuffer(null);
                }
                 // Clear the buffer used for concatenation after processing
                 currentResponseAudioBuffer.current = [];
                break;
            default: console.log(`Unhandled server event: ${eventName}`);
        }
    };

    // --- Audio Recording ---
    const startRecording = async () => {
        if (isRecordingRef.current || !isAIReady || isAISpeaking) { // Prevent recording if AI is speaking
            console.warn(`Cannot start recording. State: recording=${isRecordingRef.current}, aiReady=${isAIReady}, aiSpeaking=${isAISpeaking}`);
            return;
        }

        // Ensure AudioContext is ready
        const contextReady = await ensureAudioContext();
        if (!contextReady || !audioContext.current) {
            updateStatus("Audio system not ready. Cannot record.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const sourceNodeMic = audioContext.current.createMediaStreamSource(stream);
            if (!audioContext.current.createScriptProcessor) {
                 alert("ScriptProcessorNode is not supported in this browser. AudioWorklet implementation needed.");
                 throw new Error("ScriptProcessorNode not supported");
            }
            const processorNode = audioContext.current.createScriptProcessor(4096, 1, 1);
            const inputSampleRate = audioContext.current.sampleRate;
            const outputSampleRate = TARGET_SAMPLE_RATE; // Ensure consistency
            console.log(`Mic source SR: ${inputSampleRate}, Target SR for OpenAI: ${outputSampleRate}`);

            processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
                if (!isRecordingRef.current) { return; }
                try {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const downsampledData = downsampleBuffer(inputData, inputSampleRate, outputSampleRate);
                    const pcm16Data = floatTo16BitPCM(downsampledData);
                    if (ws.current?.readyState === WebSocket.OPEN) {
                        ws.current.send(pcm16Data.buffer);
                    } else {
                         console.warn(`WS closed during recording. Stopping. State=${ws.current?.readyState}`);
                         stopRecording();
                    }
                } catch (pe) {
                    console.error("Proc Error:", pe);
                    stopRecording();
                }
            };

             sourceNodeMic.connect(processorNode);
             processorNode.connect(audioContext.current.destination);
             audioProcessingNodes.current = { sourceNode: sourceNodeMic, processorNode: processorNode };
             setIsRecording(true); updateStatus('Recording...'); setTranscript(prev => prev + "You: (Speaking...)\n");
        } catch (error) {
             setIsRecording(false); console.error('Start Rec Error:', error); updateStatus(`Error: ${error.message}`);
             if ((error as Error).name === 'NotAllowedError') { alert('Microphone access denied. Please allow access and refresh.'); }
             else { alert(`Recording start failed: ${(error as Error).message}`); }
             streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
        }
    };

    // --- Stop Recording (No changes needed) ---
    const stopRecording = () => {
        if (!isRecordingRef.current) {
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
            if (audioProcessingNodes.current?.processorNode) {
                console.log("Disconnecting proc...");
                audioProcessingNodes.current.processorNode.onaudioprocess = null;
                audioProcessingNodes.current.processorNode.disconnect();
            }
            if (audioProcessingNodes.current?.sourceNode) {
                 console.log("Disconnecting src...");
                 audioProcessingNodes.current.sourceNode.disconnect();
            }
        } catch (de) { console.error("Disconnect err:", de); }

        audioProcessingNodes.current = null;
        updateStatus('Processing speech...');
    };

    // --- Render ---
    return (
        <div className="App">
            <h1>OpenAI Realtime Voice Chat (Concatenated Playback)</h1>
            <div className="status">
                <p>Status: {statusMessage}</p>
                <p>Backend: {isConnected ? 'Connected' : 'Disconnected'}</p>
                <p>AI: {isAIReady ? 'Ready' : 'Not Ready'}</p>
                <p>Mic: {isRecording ? 'RECORDING' : 'Idle'}</p>
                <p>Speaker: {isAISpeaking ? 'PLAYING' : 'Idle'}</p>
            </div>
            <div className="controls">
                {!isConnected && (
                    <button onClick={connectWebSocket} disabled={statusMessage.includes('Connecting')}>Connect</button>
                )}
                {isConnected && isAIReady && !isRecording && (
                    <button onClick={startRecording} disabled={!isAIReady || isAISpeaking}>Start Talking</button>
                )}
                {isRecording && (
                    <button onClick={stopRecording} className="stop-button">Stop Talking</button>
                )}
            </div>

            {/* --- Download Button (Uses lastRawAudioBuffer) --- */}
            {lastRawAudioBuffer && !isAISpeaking && (
                 <div className="controls download-controls">
                    <button onClick={() => downloadData(lastRawAudioBuffer, `response_${Date.now()}.wav`)}>
                         Download Last Response (WAV)
                    </button>
                 </div>
            )}
            {/* --- END DOWNLOAD BUTTON --- */}

            <div className="transcript-container">
                <h2>Conversation</h2>
                <pre className="transcript">{transcript}</pre>
                {currentUtterance && (<p className="current-utterance"><em>AI: {currentUtterance}</em></p>)}
            </div>
        </div>
    );
}

export default App;
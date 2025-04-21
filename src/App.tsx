import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { useWebSocket } from './hooks/useWebSocket';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { StatusBar } from './components/StatusBar';
import { Controls } from './components/Controls';
import { TranscriptDisplay } from './components/TranscriptDisplay';
import { DownloadButton } from './components/DownloadButton';

// --- Constants ---
const BACKEND_WS_URL: string = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8080';
const TARGET_SAMPLE_RATE: number = 24000;

// Define a more specific type for server event data if possible,
// otherwise acknowledge 'any' or use a broader type like Record<string, unknown>
// Using 'any' for now to resolve the immediate ESLint error, but refine if possible.
type ServerEventDataBase = {
    type: string;
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any; // Allow other properties, but try to be more specific if structure is known
};

type ServerEventAIResponseEnd = ServerEventDataBase & {
    name: 'AIResponseEnd';
    finalText?: string; // Make finalText optional as it might not always be present
};

// Union type for possible server events we handle explicitly
type HandledServerEvent = ServerEventDataBase | ServerEventAIResponseEnd;


const App: React.FC = () => {
    const [statusMessage, setStatusMessage] = useState<string | null>('Idle');
    const [transcript, setTranscript] = useState<string>('');
    const [currentUtterance, setCurrentUtterance] = useState<string>('');
    const [lastRawAudioBuffer, setLastRawAudioBuffer] = useState<ArrayBuffer | null>(null);
    const [isAIReady, setIsAIReady] = useState<boolean>(false);

    const audioContext = useRef<AudioContext | null>(null);
    const currentResponseAudioChunks = useRef<ArrayBuffer[]>([]);

    // WebSocket Hook
    const {
        connect: connectWebSocket,
        sendMessage,
        isConnected,
        isConnecting,
        error: wsError,
        setOnMessageHandler,
        setOnOpenHandler,
        setOnCloseHandler,
    } = useWebSocket(BACKEND_WS_URL);

    // Audio Context Management (ensureAudioContext remains the same)
    const ensureAudioContext = useCallback(async (): Promise<AudioContext | null> => {
        // ... (implementation from previous step)
        if (audioContext.current && audioContext.current.state === 'running') { return audioContext.current; }
        try {
            if (!audioContext.current || audioContext.current.state === 'closed') {
                console.log("[App] Initializing AudioContext...");
                audioContext.current = new (window.AudioContext || ((window as unknown) as {webkitAudioContext: typeof AudioContext}).webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
            }
            if (audioContext.current.state === 'suspended') {
                console.log("[App] Resuming suspended AudioContext..."); await audioContext.current.resume();
            }
            if (audioContext.current.state !== 'running') { throw new Error(`AC initialization failed. Final State: ${audioContext.current.state}`); }
            console.log(`[App] AudioContext is running (SR: ${audioContext.current.sampleRate}).`);
            return audioContext.current;
        } catch (e) {
            console.error("[App] Error ensuring AudioContext:", e);
            const errorMsg = e instanceof Error ? e.message : String(e);
            setStatusMessage(`FATAL Error: Audio system failed - ${errorMsg}`);
            if (audioContext.current && audioContext.current.state !== 'closed') {
                await audioContext.current.close().catch(closeErr => console.error("AC Close Error on Failure:", closeErr));
            }
            audioContext.current = null; return null;
        }
    }, []);

    // **** MOVED handleAudioData Definition UP ****
    const handleAudioData = useCallback((pcmBuffer: ArrayBuffer) => {
        if (isConnected) {
            // console.log(`[App] handleAudioData: Sending ${pcmBuffer.byteLength} bytes.`);
            sendMessage(pcmBuffer);
        } else {
            console.warn("[App] handleAudioData: WebSocket is not connected, dropping audio chunk.");
        }
    // Dependencies are correct according to ESLint (values used inside)
    }, [isConnected, sendMessage]);


    // Audio Recorder Hook (Now declared AFTER handleAudioData)
    const {
        isRecording,
        startRecording: startRecorder,
        stopRecording: stopRecorder,
        error: recorderError,
    } = useAudioRecorder(audioContext.current, handleAudioData, TARGET_SAMPLE_RATE);

    // Audio Player Hook (Declared AFTER ensureAudioContext)
    const {
        isPlaying: isAISpeaking,
        playAudio,
        stopPlayback,
        error: playerError,
    } = useAudioPlayer(ensureAudioContext, TARGET_SAMPLE_RATE);


    // --- WebSocket Event Handlers (Declared AFTER the functions they call) ---
    const handleWebSocketOpen = useCallback(() => {
        setStatusMessage('Connected. Waiting for AI...');
        setIsAIReady(false);
    }, []); // No dependencies needed

    const handleWebSocketClose = useCallback((/* event: CloseEvent */) => { // Mark event as unused if needed
        // Access state via setters or check refs if needed, avoid direct state deps if causing issues
        setStatusMessage((prevStatus) => {
            // Example: preserve error messages
            if (prevStatus?.startsWith('ERROR')) return prevStatus;
            // return `Disconnected: ${event.reason || `Code ${event.code}`}`;
             return 'Disconnected'; // Simpler message might be sufficient
        });
        setIsAIReady(false);
        // Use functional updates or check refs if stopRecorder/stopPlayback cause dependency issues
        stopRecorder();
        stopPlayback();
    // Dependencies: Include functions called if their identity might change.
    // Often setters from useState are stable, but functions from other hooks might not be.
    // If ESLint warns excessively and logic is sound, selective disabling might be needed.
    }, [stopRecorder, stopPlayback]); // Include called functions from hooks


    // --- Server Event Handler (Declared BEFORE handleWebSocketMessage) ---
    const handleServerEvent = useCallback((eventName: string, data: HandledServerEvent) => {
        // console.log("[App] Server Event:", eventName); // Simplified log
        switch (eventName) {
            case 'AIConnected':
                setIsAIReady(true);
                setStatusMessage('AI Ready');
                break;
            case 'AIResponseStart':
                setCurrentUtterance('');
                setStatusMessage('AI Thinking...');
                currentResponseAudioChunks.current = [];
                setLastRawAudioBuffer(null);
                if (isAISpeaking) stopPlayback(); // isAISpeaking state is needed here
                break;
            case 'AISpeechDetected': setStatusMessage('Hearing you...'); break;
            case 'AISpeechEnded': setStatusMessage('Processing your speech...'); break;
            case 'AIResponseEnd': {
                // Assertion to use specific type if needed, or check 'name' property
                const responseData = data as ServerEventAIResponseEnd;
                const finalAiText = responseData?.finalText || '';
                // Don't set status here if playback starts, let player handle it
                // setStatusMessage('AI Finished Speaking');

                if (finalAiText) { setTranscript(prev => prev + `AI: ${finalAiText}\n`); }
                else if (currentUtterance) { console.warn("[App] No final text, using fallback."); setTranscript(prev => prev + `AI: ${currentUtterance}\n`); }
                else { console.warn("[App] No final text, no fallback."); setTranscript(prev => prev + `AI: [Audio Response Only]\n`); }
                setCurrentUtterance(''); // Reset streaming text

                if (currentResponseAudioChunks.current.length > 0) {
                    try {
                        const totalLength = currentResponseAudioChunks.current.reduce((sum, buffer) => sum + buffer.byteLength, 0);
                        // console.log(`[App] Concatenating ${currentResponseAudioChunks.current.length} audio chunks, total size: ${totalLength} bytes`);
                        const concatenatedPcmBuffer = new ArrayBuffer(totalLength);
                        const concatenatedView = new Uint8Array(concatenatedPcmBuffer);
                        let offset = 0;
                        for (const chunk of currentResponseAudioChunks.current) {
                            concatenatedView.set(new Uint8Array(chunk), offset);
                            offset += chunk.byteLength;
                        }
                        setLastRawAudioBuffer(concatenatedPcmBuffer);
                        playAudio(concatenatedPcmBuffer).catch(playErr => {
                            console.error("Error calling playAudio:", playErr);
                            setStatusMessage(`Playback Error: ${playErr.message}`);
                        });

                    } catch (concatError) {
                        console.error("[App] Error concatenating audio buffers:", concatError);
                        setStatusMessage(`Error preparing audio: ${concatError instanceof Error ? concatError.message : String(concatError)}`);
                        setLastRawAudioBuffer(null);
                    }
                } else {
                    console.log("[App] AIResponseEnd received, but no audio chunks were buffered.");
                    setStatusMessage(isAIReady ? 'AI Ready' : 'Connecting...'); // Use isAIReady state here
                    setLastRawAudioBuffer(null);
                }
                currentResponseAudioChunks.current = [];
                break;
            }
            default:
                console.log(`[App] Unhandled server event: ${eventName}`);
        }
    // Dependencies: List state and functions *read* or *called* within the callback
    }, [isAISpeaking, stopPlayback, currentUtterance, playAudio, isAIReady]);


    const handleWebSocketMessage = useCallback((event: MessageEvent) => {
        if (typeof event.data === 'string') {
            try {
                // Use a broader type first, then narrow inside handleServerEvent if needed
                const message: Record<string, unknown> = JSON.parse(event.data);
                // Basic check for expected structure
                if (message && typeof message.type === 'string' && typeof message.name === 'string') {
                   handleServerEvent(message.name, message as HandledServerEvent);
                } else if (message && typeof message.type === 'string' && message.type === 'textDelta' && typeof message.text === 'string') {
                    setCurrentUtterance(prev => prev + message.text);
                } else if (message && typeof message.type === 'string' && message.type === 'error' && typeof message.message === 'string') {
                    console.error("[App] Backend Error:", message.message);
                    setStatusMessage(`Error: ${message.message}`);
                } else {
                    console.warn("[App] Received unknown JSON structure:", message);
                }
            } catch (e) { console.error("[App] Bad JSON:", event.data, e); }
        } else if (event.data instanceof ArrayBuffer) {
            const arrayBuffer = event.data;
            if (arrayBuffer.byteLength > 0) {
                currentResponseAudioChunks.current.push(arrayBuffer);
            } else { console.warn("[App] Empty ArrayBuffer received."); }
        } else { console.warn("[App] Unexpected WS data type:", typeof event.data); }
    }, [handleServerEvent]); // Depends only on handleServerEvent


    // --- Connect WebSocket handlers to the hook ---
    useEffect(() => {
        setOnMessageHandler(handleWebSocketMessage);
        setOnOpenHandler(handleWebSocketOpen);
        setOnCloseHandler(handleWebSocketClose);
    }, [setOnMessageHandler, setOnOpenHandler, setOnCloseHandler, handleWebSocketMessage, handleWebSocketOpen, handleWebSocketClose]);

    // --- UI Action Handlers (Declared AFTER dependent hooks/callbacks) ---
    const handleConnect = useCallback((): void => {
        ensureAudioContext().then(ready => {
            if (ready) {
                connectWebSocket();
            } else {
                // Error message set within ensureAudioContext
                console.error("[App] Cannot connect WebSocket, AudioContext failed to initialize.");
            }
        });
    // Dependencies: Functions it calls directly
    }, [connectWebSocket, ensureAudioContext]);

    const handleStartRecording = useCallback(async (): Promise<void> => {
        if (!isConnected || !isAIReady) { return; }
        const contextReady = await ensureAudioContext();
        if (contextReady) {
            if (isAISpeaking) stopPlayback();
            setTranscript(prev => prev + "You: (Speaking...)\n");
            await startRecorder();
        } else {
            setStatusMessage("ERROR: Cannot start recording. Audio system failed.");
        }
    // Dependencies: State it reads, functions it calls
    }, [isConnected, isAIReady, ensureAudioContext, startRecorder, isAISpeaking, stopPlayback]);

    const handleStopRecording = useCallback((): void => {
        stopRecorder();
        setStatusMessage('Processing speech...');
    // Dependencies: Functions it calls
    }, [stopRecorder]);


    // --- Effect to handle errors from hooks ---
    useEffect(() => { if (wsError) setStatusMessage(`WebSocket Error: ${wsError}`); }, [wsError]);
    useEffect(() => { if (recorderError) setStatusMessage(`Recording Error: ${recorderError}`); }, [recorderError]);
    useEffect(() => { if (playerError) setStatusMessage(`Playback Error: ${playerError}`); }, [playerError]);

    // --- Cleanup AudioContext on App unmount ---
    useEffect(() => {
        return () => {
            if (audioContext.current && audioContext.current.state !== 'closed') {
                console.log("[App] Cleaning up AudioContext on unmount.");
                audioContext.current.close().catch(e => console.error("[App] Error closing AC on unmount:", e));
                audioContext.current = null;
            }
        };
    }, []);

    // --- Render ---
    return (
        <div className="App">
            <h1>OpenAI Realtime Voice Chat</h1>
            <StatusBar
                message={statusMessage}
                isConnected={isConnected}
                isAIReady={isAIReady}
                isRecording={isRecording}
                isPlaying={isAISpeaking}
            />
             <Controls
                isConnected={isConnected}
                isConnecting={isConnecting}
                isAIReady={isAIReady}
                isRecording={isRecording}
                isPlaying={isAISpeaking}
                onConnect={handleConnect}
                onStartRecording={handleStartRecording}
                onStopRecording={handleStopRecording}
            />
            <DownloadButton
                lastRawAudioBuffer={lastRawAudioBuffer}
                isPlaying={isAISpeaking}
            />
             <TranscriptDisplay
                transcript={transcript}
                currentUtterance={currentUtterance}
            />
        </div>
    );
}

export default App;

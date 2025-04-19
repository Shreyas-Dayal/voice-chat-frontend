// src/App.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// --- Configuration ---
const WEBSOCKET_URL = 'ws://localhost:8080'; // Still trying to connect here
const TIMESLICE_MS = 500; // Chunk duration for MediaRecorder
const AUDIO_MIME_TYPES = [ // Prioritize Opus if available
    'audio/opus;codecs=opus',
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4', // Some browsers might support mp4
    'audio/wav', // Fallback, less ideal for web streaming/storage
];

// --- Interfaces ---
interface ChatMessage {
    id: string;
    origin: 'user' | 'system' | 'ai_placeholder'; // Added system type
    text?: string; // For system messages or AI placeholders
    blobUrl?: string; // URL for user audio playback
    timestamp: Date;
}

// --- Component ---
function App() {
    const [isConnecting, setIsConnecting] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [statusMessage, setStatusMessage] = useState("Connect or start recording");

    const webSocketRef = useRef<WebSocket | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const selectedMimeTypeRef = useRef<string | null>(null); // Store the chosen mimeType
    const objectUrlsToRevokeRef = useRef<string[]>([]); // Keep track of URLs to clean up
    const chatWindowRef = useRef<HTMLDivElement>(null); // For scrolling chat

    // --- Utility Functions ---
    const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        setChatMessages(prev => [
            ...prev,
            { ...message, id: crypto.randomUUID(), timestamp: new Date() }
        ]);
    }, []);

    // Scroll chat window to bottom when new messages are added
    useEffect(() => {
        if (chatWindowRef.current) {
            chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
        }
    }, [chatMessages]);


    // --- WebSocket Logic (Primarily for Status Display Now) ---
    const handleWsOpen = useCallback(() => {
        console.log("WebSocket Connected");
        setIsConnecting(false);
        setIsConnected(true);
        setStatusMessage("Connected to WebSocket (Backend)");
        addMessage({ origin: 'system', text: 'WebSocket connected.' });
    }, [addMessage]);

    const handleWsClose = useCallback((event: CloseEvent) => {
        console.log(`WebSocket Disconnected: Code=${event.code}, Reason=${event.reason}`);
        setIsConnecting(false);
        setIsConnected(false);
        const reason = event.reason || (event.wasClean ? 'Normal closure' : 'Connection lost');
        setStatusMessage(`WebSocket disconnected: ${reason}`);
        if (!event.wasClean) {
            addMessage({ origin: 'system', text: `WebSocket connection lost. (${reason})` });
        } else {
             addMessage({ origin: 'system', text: 'WebSocket disconnected.' });
        }
        webSocketRef.current = null;
        // No need to stop recording here, as recording is now independent
    }, [addMessage]);

    const handleWsError = useCallback((event: Event) => {
        console.error("WebSocket Error:", event);
        setIsConnecting(false);
        setIsConnected(false); // Assume disconnected on error
        setStatusMessage("WebSocket connection error.");
        addMessage({ origin: 'system', text: 'WebSocket connection error.' });
        // Close will likely follow
    }, [addMessage]);

    const handleWsMessage = useCallback(async (event: MessageEvent) => {
        // This is where AI responses would be handled if the backend were working
        console.log("Received message from WebSocket:", typeof event.data);
        if (typeof event.data === 'string') {
             addMessage({ origin: 'ai_placeholder', text: `(Received text: ${event.data})` });
        } else if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
             // In a real scenario, convert this to a blobUrl and add an 'ai' message
             addMessage({ origin: 'ai_placeholder', text: `(Received binary audio data)` });
             // For now, we won't play it back as it's not the user's voice
        }
    }, [addMessage]);

    const connectWebSocket = useCallback(() => {
        if (webSocketRef.current || isConnecting) return;

        console.log(`Attempting to connect WebSocket to ${WEBSOCKET_URL}...`);
        setIsConnecting(true);
        setStatusMessage("Connecting to WebSocket...");
        addMessage({ origin: 'system', text: 'Attempting WebSocket connection...' });

        try {
            const ws = new WebSocket(WEBSOCKET_URL);
            ws.binaryType = "arraybuffer"; // Or "blob"
            ws.onopen = handleWsOpen;
            ws.onclose = handleWsClose;
            ws.onerror = handleWsError;
            ws.onmessage = handleWsMessage;
            webSocketRef.current = ws;
        } catch (error) {
            console.error("Failed to create WebSocket:", error);
            setIsConnecting(false);
            setStatusMessage("Error creating WebSocket.");
            addMessage({ origin: 'system', text: 'Failed to initiate WebSocket connection.' });
        }
    }, [isConnecting, handleWsOpen, handleWsClose, handleWsError, handleWsMessage, addMessage]);

    // --- MediaRecorder Logic (User Audio Recording & Local Playback) ---
    const startRecording = async () => {
        if (isRecording) return;

        // --- Get Media Stream ---
        try {
            if (streamRef.current) { // Clean up previous stream just in case
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            console.error("Error accessing microphone:", error);
            setStatusMessage("Microphone access denied or unavailable.");
            addMessage({ origin: 'system', text: 'Error: Could not access microphone.' });
            return;
        }

        // --- Find Supported MIME Type ---
        selectedMimeTypeRef.current = AUDIO_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || null;
        if (!selectedMimeTypeRef.current) {
             console.error("No supported audio MIME type found.");
             setStatusMessage("Browser lacks supported audio format.");
             addMessage({ origin: 'system', text: "Error: Browser doesn't support required audio recording formats." });
             streamRef.current?.getTracks().forEach(track => track.stop());
             streamRef.current = null;
             return;
        }
        console.log("Using MIME type for recording:", selectedMimeTypeRef.current);

        // --- Create and Configure MediaRecorder ---
        try {
            recordedChunksRef.current = []; // Clear previous chunks
            const recorder = new MediaRecorder(streamRef.current, { mimeType: selectedMimeTypeRef.current });
            mediaRecorderRef.current = recorder;

            recorder.ondataavailable = (event: BlobEvent) => {
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                    // If connected, send to backend
                    if (webSocketRef.current?.readyState === WebSocket.OPEN) {
                         // console.log("Sending audio chunk to backend:", event.data.size);
                         webSocketRef.current.send(event.data);
                    }
                }
            };

            recorder.onstop = () => {
                console.log("Recording stopped.");
                setIsRecording(false);
                setStatusMessage("Processing audio...");

                // --- Create Blob and Object URL for Local Playback ---
                if (recordedChunksRef.current.length > 0 && selectedMimeTypeRef.current) {
                    const completeBlob = new Blob(recordedChunksRef.current, { type: selectedMimeTypeRef.current });
                    const blobUrl = URL.createObjectURL(completeBlob);
                    objectUrlsToRevokeRef.current.push(blobUrl); // Track for cleanup

                    console.log(`Created Blob URL: ${blobUrl} (Size: ${completeBlob.size} bytes)`);

                    // Add user message to chat
                    addMessage({
                        origin: 'user',
                        blobUrl: blobUrl,
                    });
                    setStatusMessage("Recording finished. Ready to record again.");

                } else {
                     console.warn("No audio data recorded.");
                     setStatusMessage("No audio data captured. Ready to record again.");
                      addMessage({ origin: 'system', text: 'No audio captured in last recording.' });
                }

                // Clean up stream tracks *after* processing
                streamRef.current?.getTracks().forEach(track => track.stop());
                streamRef.current = null;
                mediaRecorderRef.current = null; // Clean up recorder instance
                recordedChunksRef.current = []; // Clear chunks

                 // Optional: Send end-of-stream marker if backend needs it and is connected
                 // if (webSocketRef.current?.readyState === WebSocket.OPEN) {
                 //     webSocketRef.current.send(JSON.stringify({ type: 'EndOfUserAudio' }));
                 // }
            };

             recorder.onerror = (event) => {
                 console.error("MediaRecorder Error:", event);
                 addMessage({ origin: 'system', text: `Recording Error: ${event}` });
                 setStatusMessage("Error during recording.");
                 // Attempt to stop cleanly if possible
                 if (recorder.state === 'recording') {
                     recorder.stop();
                 }
                 setIsRecording(false); // Ensure state is reset
                 streamRef.current?.getTracks().forEach(track => track.stop());
                 streamRef.current = null;
                 mediaRecorderRef.current = null;
             };

            recorder.start(TIMESLICE_MS); // Start recording
            setIsRecording(true);
            setStatusMessage("🔴 Recording... Click button to stop.");
            addMessage({ origin: 'system', text: 'Recording started...' });


        } catch(error) {
             console.error("Error creating MediaRecorder:", error);
             addMessage({ origin: 'system', text: `Error setting up recorder: ${error}` });
             setStatusMessage("Failed to start recorder.");
             streamRef.current?.getTracks().forEach(track => track.stop()); // Clean up stream
             streamRef.current = null;
             setIsRecording(false);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop(); // This triggers 'onstop' handler
            // State updates (isRecording=false, status, etc.) happen in 'onstop'
        } else {
            console.warn("Stop recording called but recorder not active.");
        }
    };

    // --- Button Click Handler ---
    const handleToggleRecord = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    // --- Effects ---
    // Attempt WebSocket connection on mount (optional)
    useEffect(() => {
        connectWebSocket();
    }, [connectWebSocket]);

    // Cleanup effect on component unmount
    useEffect(() => {
        return () => {
            console.log("Cleaning up App component...");
            // Stop recording if active
            if (mediaRecorderRef.current?.state === "recording") {
                mediaRecorderRef.current.stop();
            }
            // Stop media tracks
            streamRef.current?.getTracks().forEach(track => track.stop());
            // Close WebSocket
            webSocketRef.current?.close(1000, "Component unmounting");
            // Revoke all created Object URLs
            console.log("Revoking Object URLs:", objectUrlsToRevokeRef.current);
            objectUrlsToRevokeRef.current.forEach(url => URL.revokeObjectURL(url));
            objectUrlsToRevokeRef.current = [];
            // Clear refs
            mediaRecorderRef.current = null;
            webSocketRef.current = null;
            streamRef.current = null;
        };
    }, []); // Empty dependency array ensures this runs only on unmount


    // --- Render ---
    return (
        <div className="App">
            <header className="App-header">
                <h2>Voice Chat Simulation</h2>
                <div className="connection-status">
                    WebSocket: <span className={isConnected ? 'connected' : 'disconnected'}>
                        {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
                    </span>
                     {!isConnected && !isConnecting && (
                        <button onClick={connectWebSocket} className="connect-button">Retry Connect</button>
                    )}
                </div>
            </header>

            <div className="chat-window" ref={chatWindowRef}>
                {chatMessages.map((msg) => (
                    <div key={msg.id} className={`message ${msg.origin}`}>
                         <span className="timestamp">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {msg.origin === 'user' && msg.blobUrl && (
                            <div className="audio-message">
                                <audio src={msg.blobUrl} controls preload="metadata" />
                            </div>
                        )}
                         {msg.origin === 'system' && (
                            <p className="system-text"><em>{msg.text}</em></p>
                        )}
                        {msg.origin === 'ai_placeholder' && (
                            <p className="ai-text">{msg.text || '(AI response placeholder)'}</p>
                        )}
                    </div>
                ))}
            </div>

            <footer className="App-footer">
                <p className="status-line">{statusMessage}</p>
                <button
                    onClick={handleToggleRecord}
                    // Disable button briefly during connection attempts? Maybe not necessary now.
                    // disabled={isConnecting}
                    className={`record-button ${isRecording ? 'recording' : ''}`}
                >
                    {isRecording ? 'Stop Recording' : 'Start Recording'}
                </button>
            </footer>
        </div>
    );
}

export default App;
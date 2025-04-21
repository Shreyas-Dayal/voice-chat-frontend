// src/App.tsx
import React, { useState, useEffect, useRef, useCallback, CSSProperties } from 'react';
import 'antd/dist/reset.css';
import { Layout, Typography, ConfigProvider, App as AntApp, Tooltip, Button } from 'antd'; // Import AntApp and ConfigProvider

// Hooks - Assuming these are correctly implemented as discussed previously
import useAudioContext from './hooks/useAudioContext'; // Assuming this provides the ensure function
import { useWebSocket } from './hooks/useWebSocket';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import useServerEvents from './hooks/useServerEvents'; // Assuming useServerEvents hook exists

// Components - Assuming these exist and use inline styles as discussed
import { MessagesList } from './components/MessagesList';
import { ControlBar } from './components/ControlBar';
import { MaximizedView } from './components/MaximizedView';
import { DownloadButton } from './components/DownloadButton'; // Assuming DownloadButton component exists

// Constants
import { BACKEND_WS_URL, TARGET_SAMPLE_RATE } from './constants';
import { Content, Footer, Header } from 'antd/es/layout/layout';
import { DownCircleOutlined, UpCircleOutlined } from '@ant-design/icons';

// Define Layout styles inline
const layoutStyle: CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
};
const headerStyle: CSSProperties = {
    background: '#fff', // Changed to white for contrast with dark text
    borderBottom: '1px solid #f0f0f0',
    padding: '0 20px',
    flexShrink: 0, // Prevent header from shrinking
    display: 'flex',
    alignItems: 'center',
};
const headerTitleStyle: CSSProperties = {
     color: '#333', // Darker text for white background
     margin: 0, // Remove default margin
     lineHeight: '64px', // Align vertically
};
const contentStyle: CSSProperties = {
    flexGrow: 1,
    overflow: 'hidden', // Important for controlling scroll behavior
    display: 'flex',
    flexDirection: 'column', // Children stack vertically
    position: 'relative', // Needed for absolute positioning of DownloadButton
    justifyContent:'center'
};
const messagesListContainerStyle: CSSProperties = {
     flexGrow: 1,
     overflowY: 'auto', // Allow scrolling for messages
     padding: '1rem',
     background: '#f7f7f7', // Light background for chat area
};
const footerStyle: CSSProperties = {
    padding: '10px 0', // Reduce vertical padding
    background: '#fff',
    borderTop: '1px solid #f0f0f0',
    flexShrink: 0, // Prevent footer from shrinking
};
const downloadButtonContainerStyle: CSSProperties = {
    position: 'absolute',
    bottom: '90px', // Position above the minimize button in MaximizedView
    right: '25px',
    zIndex: 10,
};
const headerButtonStyle: CSSProperties = {
    fontSize: '22px', // Slightly smaller icon in header
    color: '#888', // Match secondary text color perhaps
    marginLeft: 'auto', // Push to the right
    marginRight:'1rem'
};


const App: React.FC = () => {
  // ─── State & Refs ─────────────────────────────────────
  const [isMicMinimized, setIsMicMinimized] = useState(false); // Start Maximized
  const [statusMessage, setStatusMessage] = useState<string | null>('Initializing...');
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUtterance, setCurrentUtterance] = useState<string>('');
  const [lastRawAudioBuffer, setLastRawAudioBuffer] = useState<ArrayBuffer | null>(null);
  const [isAIReady, setIsAIReady] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null); // Consolidated error state

  // Use the hook to get the ensure function
  const ensureAudioContext = useAudioContext();
  // Ref to hold the actual AudioContext instance once created/resumed
  const audioContextInstance = useRef<AudioContext | null>(null);

  // ─── WebSocket Hook ────────────────────────────────────
  const {
    connect: wsConnect, // Renamed to avoid conflict
    disconnect: wsDisconnect, // Renamed
    sendMessage,
    isConnected,
    isConnecting,
    error: wsError,
    setOnOpenHandler,
    setOnCloseHandler,
    setOnMessageHandler,
  } = useWebSocket(BACKEND_WS_URL);

  // ─── Get AudioContext Instance (Helper) ────────────────
  // This function ensures the context exists and is running, updating the ref
  const getAudioContext = useCallback(async (): Promise<AudioContext | null> => {
      if (audioContextInstance.current && audioContextInstance.current.state === 'running') {
        return audioContextInstance.current;
      }
      try {
        const ctx = await ensureAudioContext(); // Call the function from the hook
        if (ctx) {
            audioContextInstance.current = ctx; // Store the obtained context
            return ctx;
        } else {
            throw new Error("AudioContext creation/resume failed.");
        }
      } catch (e) {
          const errorMsg = `Audio Context Error: ${e instanceof Error ? e.message : String(e)}`;
          console.error(errorMsg, e);
          setLastError(errorMsg);
          setStatusMessage("Audio System Error");
          audioContextInstance.current = null;
          return null;
      }
  }, [ensureAudioContext]); // Dependency on the function from the hook

  // ─── Send PCM to backend ───────────────────────────────
  const handleAudioData = useCallback(
    (pcm: ArrayBuffer) => {
      if (isConnected && isAIReady) { // Also check if AI is ready before sending
          sendMessage(pcm);
      }
      // else console.warn('WS not ready or AI not ready; dropping audio chunk');
    },
    [isConnected, isAIReady, sendMessage]
  );

  // ─── Recorder & Player Hooks ───────────────────────────
  const {
    isRecording,
    startRecording,
    stopRecording,
    error: recorderError,
  } = useAudioRecorder(
    audioContextInstance.current, // Pass the *current value* of the ref
    handleAudioData,
    TARGET_SAMPLE_RATE
    // Hook internally checks if context is valid before using it
  );

  const {
    isPlaying: isAISpeaking,
    playAudio,
    stopPlayback,
    error: playerError,
  } = useAudioPlayer(
      ensureAudioContext, // Pass the ensure function directly to the player hook
      TARGET_SAMPLE_RATE
    );

  // ─── Server Event Hook ─────────────────────────────────
  // Using the dedicated hook for clarity
  const { handleMessage: handleWsMessage } = useServerEvents(
      isAISpeaking,
      playAudio,
      stopPlayback,
      isAIReady,
      setStatusMessage,
      setIsAIReady,
      setMessages,
      setCurrentUtterance,
      setLastRawAudioBuffer // Pass the setter for the download buffer
  );

  // ─── Wire up WS handlers ────────────────────────────────
  useEffect(() => {
    setOnOpenHandler(() => {
      setStatusMessage('Connected, waiting for AI...');
      setIsAIReady(false); // Reset on new connection
      setLastError(null);
    });
    setOnCloseHandler((ev) => {
      setStatusMessage(`Disconnected: ${ev.reason || `Code ${ev.code}`}`);
      setIsAIReady(false);
      if (isRecording) stopRecording(); // Stop recording if disconnected
      if (isAISpeaking) stopPlayback(); // Stop playback
      if (ev.code !== 1000 && ev.code !== 1001) { // Log unexpected close
          const errorMsg = `WebSocket closed unexpectedly (Code: ${ev.code})`;
           setLastError(errorMsg);
           console.warn(errorMsg);
      } else {
           setLastError(null);
      }
    });
    setOnMessageHandler(handleWsMessage); // Use handler from useServerEvents
  }, [
    setOnOpenHandler,
    setOnCloseHandler,
    setOnMessageHandler,
    handleWsMessage, // Add dependency
    isRecording,    // Add dependency
    isAISpeaking,   // Add dependency
    stopRecording,
    stopPlayback,
  ]);

  // ─── Auto‐connect on mount ──────────────────────────────
  const connect = useCallback(() => {
    if (isConnected || isConnecting) return;
    // Ensure audio context *before* attempting WS connection
    getAudioContext().then((ac) => {
      if (ac) {
          setStatusMessage('Connecting to backend...');
          wsConnect(); // Connect WebSocket only if audio is ready
      } else {
          // Error message already set by getAudioContext
      }
    });
  }, [isConnected, isConnecting, getAudioContext, wsConnect]);

  useEffect(() => {
    connect(); // Attempt connection on mount
  }, [connect]); // Include connect in dependency array


  // ─── Mic toggle ────────────────────────────────────────
  const handleMicClick = useCallback(async () => {
    setLastError(null); // Clear previous error on interaction

    if (isRecording) {
      stopRecording();
      // Maybe set status to "Processing..." or similar? Depends on backend speed.
      // setStatusMessage('Processing...');
    } else {
      // Pre-checks
      if (!isConnected) {
          setLastError("Not connected to the server.");
          setStatusMessage("Disconnected");
          return;
      }
       if (!isAIReady) {
          setLastError("AI service is not ready yet.");
          setStatusMessage("Waiting for AI...");
          return;
      }
      if (isConnecting) {
          setLastError("Still connecting...");
          setStatusMessage("Connecting...");
          return;
      }

      // Ensure Audio Context is active *before* starting
      const ac = await getAudioContext();
      if (!ac) {
        // Error state/message handled within getAudioContext
        return;
      }

      // Stop AI playback if user interrupts
      if (isAISpeaking) {
          stopPlayback();
      }

      // Clear previous AI utterance if needed
      // setCurrentUtterance('');

      // Attempt to start recording
      try {
          await startRecording(); // Assumes startRecording is async and might throw/return errors
          // setStatusMessage('Listening...'); // Status set by recorder hook might be sufficient
      } catch (err) {
          const errorMsg = `Microphone Error: ${err instanceof Error ? err.message : String(err)}`;
          console.error(errorMsg, err);
          setLastError(errorMsg);
          setStatusMessage("Mic Error");
      }
    }
  }, [
    isRecording,
    isConnected,
    isAIReady,
    isConnecting,
    isAISpeaking,
    getAudioContext, // Use the helper
    startRecording,
    stopRecording,
    stopPlayback,
  ]);

  // --- Minimize/Maximize Toggle ---
  const toggleMicMinimize = useCallback(() => {
      setIsMicMinimized(prev => !prev);
  }, []);

  // ─── Show any hook errors ──────────────────────────────
  useEffect(() => {
    const currentError = wsError || recorderError || playerError;
    if (currentError && currentError !== lastError) { // Only update if error changes
      setLastError(currentError);
      // Use a more specific status message if possible, or keep the hook's message
      // setStatusMessage(`Error: ${currentError}`);
      console.error("Error State Updated:", currentError);
    }
    // Reset error if connection recovers and no other errors exist? (Optional)
    // if (isConnected && !currentError && lastError) {
    //    setLastError(null);
    // }

  }, [wsError, recorderError, playerError, lastError, isConnected]); // Added isConnected


  // ─── Cleanup on unmount ────────────────────────────────
  useEffect(() => {
    return () => {
      if (audioContextInstance.current && audioContextInstance.current.state !== 'closed') {
        audioContextInstance.current.close().catch(() => {});
      }
      wsDisconnect(1001, 'Component Unmounting'); // Use renamed disconnect
    };
  }, [wsDisconnect]); // Dependency on renamed disconnect

  // ─── Render ────────────────────────────────────────────
  return (
    // Wrap with AntD providers for theme and context (like message API)
    <ConfigProvider theme={{ /* Customize AntD theme if needed */ }}>
        <AntApp>
            <Layout style={layoutStyle}>
                {/* Header now contains the toggle button */}
                <Header style={headerStyle}>
                    <Typography.Title level={4} style={headerTitleStyle}>
                        VoiceChat AI
                    </Typography.Title>
                </Header>

                {/* Content area switches layout based on isMicMinimized */}
                {/* Moved Toggle Button Here */}
                <Tooltip title={isMicMinimized ? "Maximize View" : "Minimize to Chat"}>
                    <Button
                        type="text" // Use text button for subtle appearance
                        icon={isMicMinimized ? <UpCircleOutlined /> : <DownCircleOutlined />}
                        style={headerButtonStyle}
                        onClick={toggleMicMinimize}
                        disabled={isConnecting} // Maybe disable during connection?
                    />
                </Tooltip>
                <Content style={contentStyle}>
                    {!isMicMinimized ? (
                        // Maximized View (Large Mic)
                        <MaximizedView
                            isRecording={isRecording}
                            isConnecting={isConnecting}
                            isConnected={isConnected}
                            isAIReady={isAIReady}
                            isAISpeaking={isAISpeaking}
                            statusMessage={statusMessage} // Pass status for context
                            onMicClick={handleMicClick}
                            // toggleMicMinimize={toggleMicMinimize}
                            error={lastError} // Pass consolidated error
                        />
                    ) : (
                        // Minimized View (Chat + Control Bar)
                        <>
                            {/* Container for scrollable messages */}
                            <div style={messagesListContainerStyle}>
                                <MessagesList messages={messages} isMicMinimized={isMicMinimized} />
                                {/* Optionally display live AI utterance transcription here */}
                                {currentUtterance && !isAISpeaking && (
                                    <Typography.Text italic style={{ padding: '0 1rem', color: '#888', display: 'block' }}>
                                        AI: {currentUtterance}...
                                    </Typography.Text>
                                )}
                            </div>
                            {/* Footer sticks to bottom */}
                            <Footer style={footerStyle}>
                                <ControlBar
                                    isRecording={isRecording}
                                    isConnecting={isConnecting}
                                    isConnected={isConnected}
                                    isAIReady={isAIReady}
                                    isAISpeaking={isAISpeaking}
                                    statusMessage={statusMessage}
                                    onMicClick={handleMicClick}
                                    isMicMinimized={isMicMinimized}
                                    // toggleMicMinimize={toggleMicMinimize}
                                    error={lastError}
                                />
                            </Footer>
                        </>
                    )}
                     {/* Download Button positioned absolutely in Maximized view */}
                     {/* Only show when not minimized, AI not speaking, and buffer exists */}
                    {!isMicMinimized && !isAISpeaking && lastRawAudioBuffer && (
                        <div style={downloadButtonContainerStyle}>
                            <DownloadButton lastRawAudioBuffer={lastRawAudioBuffer} isPlaying={isAISpeaking} />
                        </div>
                    )}
                </Content>
            </Layout>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
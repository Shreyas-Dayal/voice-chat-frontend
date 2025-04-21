// src/App.tsx
import React, { useState, useEffect, useRef, useCallback, CSSProperties } from 'react';
// import 'antd/dist/reset.css';
import { Layout, Typography, ConfigProvider, App as AntApp, Tooltip, Button, Space, theme } from 'antd'; // Import AntApp and ConfigProvider

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
import { DownCircleOutlined, MoonOutlined, SunOutlined, UpCircleOutlined } from '@ant-design/icons';
import useMediaQuery from './hooks/useMediaQuery';

// --- Styles (Keep existing styles) ---
const layoutStyle: CSSProperties = { /* ... */
    minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--ant-color-bg-layout)', color:'var(--ant-text-color)',
};
const headerStyleBase: CSSProperties = { /* ... */
    borderBottom: '1px solid var(--ant-border-color-split)', padding: '0 16px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--ant-layout-header-background)',
};
const headerTitleStyle: CSSProperties = { /* ... */
     margin: 0, lineHeight: '64px', whiteSpace: 'nowrap', color: 'var(--ant-color-text)', // Explicitly use theme text color
};
const contentStyle: CSSProperties = { /* ... */
    flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', justifyContent: 'center',
};
const messagesListContainerStyle: CSSProperties = { /* ... */
     flexGrow: 1, overflowY: 'auto', padding: '1rem', backgroundColor: 'var(--ant-color-bg-container)', // Use theme container bg
};
const footerStyle: CSSProperties = { /* ... */
    padding: '10px 0', background: 'var(--ant-layout-footer-background)', borderTop: '1px solid var(--ant-border-color-split)', flexShrink: 0,
};
const downloadButtonContainerStyle: CSSProperties = { /* ... */
    position: 'absolute', bottom: '25px', right: '25px', zIndex: 10,
};
const headerIconButtonStyle: CSSProperties = { /* ... */
    fontSize: '20px', color: 'var(--ant-text-color-secondary)', cursor: 'pointer',
};
// --- End Styles ---



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
    
  // ─── Theme and State Setup ───────────────────────────────────
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');

  const toggleTheme = useCallback(() => {
    setThemeMode((prevMode) => {
      const newMode = prevMode === 'light' ? 'dark' : 'light';
      localStorage.setItem('themeMode', newMode); // Save user preference
      return newMode;
    });
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem('themeMode') as 'light' | 'dark' | null;
    if (savedTheme) {
      setThemeMode(savedTheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setThemeMode(prefersDark ? 'dark' : 'light');
    }
  }, []);

  // ─── Mobile Detection ────────────────────────────────────────
  const isMobile = useMediaQuery('(max-width: 767px)'); // Use your custom hook for responsiveness

  // ─── Theme Setup ────────────────────────────────────────────
  const themeSettings = {
    algorithm: themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    cssVar: true, 
    hashed: false,  // optional: for easier debugging
    // components: {
    // //   Button: {
    // //     borderRadius: 8,
    // //   },
    //   // You can add custom component-specific theme overrides if needed
    // },
  };

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
    <ConfigProvider theme={themeSettings}>
        <AntApp> {/* Provides context for message.success/error etc. */}
            <Layout style={layoutStyle}>
                <Header style={headerStyleBase} > {/* Use base style */}
                    <Typography.Title level={4} style={headerTitleStyle}>
                        VoiceChat AI
                    </Typography.Title>
                    {/* Use Space for multiple header icons */}
                    <Space style={{ marginLeft: 'auto' }}>
                        <Tooltip title={`Switch to ${themeMode === 'light' ? 'Dark' : 'Light'} Mode`}>
                             <Button
                                 type="text"
                                 shape="circle"
                                 icon={themeMode === 'light' ? <MoonOutlined /> : <SunOutlined />}
                                 style={headerIconButtonStyle}
                                 onClick={toggleTheme}
                             />
                         </Tooltip>
                        <Tooltip title={isMicMinimized ? "Maximize View" : "Minimize to Chat View"}>
                            <Button
                                type="text"
                                shape="circle"
                                icon={isMicMinimized ? <UpCircleOutlined /> : <DownCircleOutlined />}
                                style={headerIconButtonStyle}
                                onClick={toggleMicMinimize}
                                disabled={isConnecting}
                            />
                        </Tooltip>
                    </Space>
                </Header>

                <Content style={contentStyle}>
                    {!isMicMinimized ? (
                        <MaximizedView
                            isRecording={isRecording}
                            isConnecting={isConnecting}
                            isConnected={isConnected}
                            isAIReady={isAIReady}
                            isAISpeaking={isAISpeaking}
                            statusMessage={statusMessage}
                            onMicClick={handleMicClick}
                            error={lastError}
                            isMobile={isMobile} // Pass mobile flag
                        />
                    ) : (
                        <>
                            <div style={messagesListContainerStyle}>
                                {/* Pass isMobile to MessagesList if it needs adjustments */}
                                <MessagesList messages={messages} isMicMinimized={isMicMinimized} /* isMobile={isMobile} */ />
                                {currentUtterance && !isAISpeaking && (
                                    <Typography.Text italic style={{ padding: '0 1rem', color: 'var(--ant-text-color-secondary)', display: 'block' }}>
                                        AI: {currentUtterance}...
                                    </Typography.Text>
                                )}
                            </div>
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
                                    error={lastError}
                                    isMobile={isMobile} // Pass mobile flag
                                />
                            </Footer>
                        </>
                    )}
                    {!isMicMinimized && !isAISpeaking && lastRawAudioBuffer && (
                        <div style={downloadButtonContainerStyle}>
                             {/* Pass isMobile if download button needs style changes */}
                            <DownloadButton lastRawAudioBuffer={lastRawAudioBuffer} isPlaying={isAISpeaking} /* isMobile={isMobile} */ />
                        </div>
                    )}
                </Content>
            </Layout>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
// App.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'antd/dist/reset.css';
import { Layout, Typography, Space } from 'antd';
import { BulbOutlined } from '@ant-design/icons';

// Hooks
import { useWebSocket } from './hooks/useWebSocket';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useAudioPlayer } from './hooks/useAudioPlayer';

// Components
import { MessagesList } from './components/MessagesList';
import { ControlBar } from './components/ControlBar';

// Type
// — Constants —
const BACKEND_WS_URL =
  import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8080';
const TARGET_SAMPLE_RATE = 24000;

// — Helper: wrap raw PCM in a WAV header —
function addWavHeader(
  pcmData: ArrayBuffer,
  sampleRate: number,
  numChannels: number,
  bytesPerSample: number
): ArrayBuffer {
  const dataSize = pcmData.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (off: number, s: string) =>
    Array.from(s).forEach((c, i) =>
      view.setUint8(off + i, c.charCodeAt(0))
    );

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(
    28,
    sampleRate * numChannels * bytesPerSample,
    true
  );
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcmData));
  return buffer;
}

const { Header, Content, Footer } = Layout;

const App: React.FC = () => {
  // ─── State & Refs ─────────────────────────────────────
  const [statusMessage, setStatusMessage] = useState<string | null>(
    'Initializing...'
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUtterance, setCurrentUtterance] = useState<string>('');
  const [lastRawAudioBuffer, setLastRawAudioBuffer] = useState<
    ArrayBuffer | null
  >(null);
  const [isAIReady, setIsAIReady] = useState(false);

  const audioContext = useRef<AudioContext | null>(null);
  const responseChunks = useRef<ArrayBuffer[]>([]);

  // ─── WebSocket Hook ────────────────────────────────────
  const {
    connect,
    disconnect,
    sendMessage,
    isConnected,
    isConnecting,
    error: wsError,
    setOnOpenHandler,
    setOnCloseHandler,
    setOnMessageHandler,
  } = useWebSocket(BACKEND_WS_URL);

  // ─── Ensure AudioContext ───────────────────────────────
  const ensureAudioContext = useCallback(async (): Promise<AudioContext | null> => {
    if (audioContext.current?.state === 'running') {
      return audioContext.current;
    }
    try {
      if (!audioContext.current || audioContext.current.state === 'closed') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: TARGET_SAMPLE_RATE,
        });
      }
      if (audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
      }
      if (audioContext.current.state !== 'running') {
        throw new Error(`Bad state: ${audioContext.current.state}`);
      }
      return audioContext.current;
    } catch (e) {
      console.error('AudioContext failed:', e);
      setStatusMessage(
        `Audio init error: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      if (audioContext.current) {
        await audioContext.current.close().catch(() => {});
      }
      audioContext.current = null;
      return null;
    }
  }, []);

  // ─── Send PCM to backend ───────────────────────────────
  const handleAudioData = useCallback(
    (pcm: ArrayBuffer) => {
      if (isConnected) sendMessage(pcm);
      else console.warn('WS not ready; dropping audio chunk');
    },
    [isConnected, sendMessage]
  );

  // ─── Recorder & Player Hooks ───────────────────────────
  const {
    isRecording,
    startRecording,
    stopRecording,
    error: recorderError,
  } = useAudioRecorder(
    audioContext.current,
    handleAudioData,
    TARGET_SAMPLE_RATE
  );

  const {
    isPlaying: isAISpeaking,
    playAudio,
    stopPlayback,
    error: playerError,
  } = useAudioPlayer(ensureAudioContext, TARGET_SAMPLE_RATE);

  // ─── Server‐side Event Handling ────────────────────────
  const handleServerEvent = useCallback(
    (name: string, data: HandledServerEvent) => {
      switch (name) {
        case 'AIConnected':
          setIsAIReady(true);
          setStatusMessage('AI Ready');
          break;

        case 'AIResponseStart':
          setCurrentUtterance('');
          setStatusMessage('AI Thinking...');
          responseChunks.current = [];
          setLastRawAudioBuffer(null);
          if (isAISpeaking) stopPlayback();
          break;

        case 'AIResponseEnd': {
          const evt = data as ServerEventAIResponseEnd;
          const text = evt.finalText?.trim() || '[Audio only]';
          setMessages((m) => [
            ...m,
            { id: `ai-${Date.now()}`, sender: 'ai', text, timestamp: Date.now() },
          ]);
          setCurrentUtterance('');

          if (responseChunks.current.length) {
            // concatenate & play
            const total = responseChunks.current.reduce(
              (sum, b) => sum + b.byteLength,
              0
            );
            const buf = new ArrayBuffer(total);
            const view = new Uint8Array(buf);
            let offset = 0;
            for (const chunk of responseChunks.current) {
              view.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
            }
            setLastRawAudioBuffer(buf);
            playAudio(buf).catch((e) =>
              setStatusMessage(`Playback error: ${e}`)
            );
          } else {
            setStatusMessage(isAIReady ? 'AI Ready' : 'Connected…');
            setLastRawAudioBuffer(null);
          }

          responseChunks.current = [];
          break;
        }
      }
    },
    [isAISpeaking, playAudio, stopPlayback, isAIReady]
  );

  const handleWsMessage = useCallback(
    (evt: MessageEvent) => {
      if (typeof evt.data === 'string') {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'event' && msg.name) {
            handleServerEvent(msg.name, msg);
          } else if (msg.type === 'textDelta' && msg.text) {
            setCurrentUtterance((u) => u + msg.text);
          } else if (msg.type === 'error') {
            setStatusMessage(`Error: ${msg.message}`);
          }
        } catch {
          console.error('Invalid JSON:', evt.data);
        }
      } else if (evt.data instanceof ArrayBuffer) {
        responseChunks.current.push(evt.data);
      }
    },
    [handleServerEvent]
  );

  // ─── Wire up WS handlers ────────────────────────────────
  useEffect(() => {
    setOnOpenHandler(() => {
      setStatusMessage('Connected to backend…');
      setIsAIReady(false);
    });
    setOnCloseHandler(() => {
      setStatusMessage('Disconnected');
      setIsAIReady(false);
      stopRecording();
      stopPlayback();
    });
    setOnMessageHandler(handleWsMessage);
  }, [
    setOnOpenHandler,
    setOnCloseHandler,
    setOnMessageHandler,
    handleWsMessage,
    stopRecording,
    stopPlayback,
  ]);

  // ─── Auto‐connect on mount ──────────────────────────────
  const handleConnect = useCallback(() => {
    if (isConnected || isConnecting) return;
    ensureAudioContext().then((ac) => {
      if (ac) connect();
      else setStatusMessage('Cannot connect: audio init failed');
    });
  }, [isConnected, isConnecting, ensureAudioContext, connect]);

  useEffect(() => {
    handleConnect();
  }, [handleConnect]);

  // ─── Mic toggle ────────────────────────────────────────
  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      setStatusMessage('Processing your speech…');
    } else {
      if (!isConnected || !isAIReady || isConnecting) {
        if (!isConnected && !isConnecting) handleConnect();
        return;
      }
      const ac = await ensureAudioContext();
      if (!ac) {
        setStatusMessage('Cannot record: audio init failed');
        return;
      }
      if (isAISpeaking) stopPlayback();
      setCurrentUtterance('');
      await startRecording();
      setStatusMessage('Listening…');
    }
  }, [
    isRecording,
    isConnected,
    isAIReady,
    isConnecting,
    isAISpeaking,
    ensureAudioContext,
    startRecording,
    stopRecording,
    stopPlayback,
    handleConnect,
  ]);

  // ─── Download last response ────────────────────────────
  const handleDownload = useCallback(() => {
    if (!lastRawAudioBuffer) {
      alert('No audio to download.');
      return;
    }
    try {
      const wav = addWavHeader(
        lastRawAudioBuffer,
        TARGET_SAMPLE_RATE,
        1,
        2
      );
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `response_${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Download failed: ${e}`);
    }
  }, [lastRawAudioBuffer]);

  // ─── Show any hook errors ──────────────────────────────
  useEffect(() => {
    if (wsError) setStatusMessage(`WS error: ${wsError}`);
  }, [wsError]);
  useEffect(() => {
    if (recorderError) setStatusMessage(`Record error: ${recorderError}`);
  }, [recorderError]);
  useEffect(() => {
    if (playerError) setStatusMessage(`Play error: ${playerError}`);
  }, [playerError]);

  // ─── Cleanup on unmount ────────────────────────────────
  useEffect(() => {
    return () => {
      if (audioContext.current && audioContext.current.state !== 'closed') {
        audioContext.current.close().catch(() => {});
      }
      disconnect(1001, 'Unmounting');
    };
  }, [disconnect]);

  // ─── Render ────────────────────────────────────────────
  return (
    <Layout style={{ height: '100vh' }}>
      <Header
        style={{ display: 'flex', alignItems: 'center', padding: '0 16px' }}
      >
        <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>
          VoiceChat AI
        </Typography.Title>
        <Space style={{ marginLeft: 'auto' }}>
          <BulbOutlined
            onClick={() =>
              document.documentElement.classList.toggle('dark')
            }
            style={{ color: '#fff', fontSize: '1.4rem', cursor: 'pointer' }}
            title="Toggle Dark Mode"
          />
        </Space>
      </Header>

      <Content style={{ padding: '16px', overflow: 'hidden' }}>
        <MessagesList messages={messages} />
        {currentUtterance && (
          <Typography.Text italic style={{ marginTop: 8, display: 'block' }}>
            AI: {currentUtterance}
          </Typography.Text>
        )}
      </Content>

      <Footer style={{ padding: '8px 16px' }}>
        <ControlBar
          isRecording={isRecording}
          isConnecting={isConnecting}
          isConnected={isConnected}
          isAIReady={isAIReady}
          isAISpeaking={isAISpeaking}
          statusMessage={statusMessage}
          onMicClick={handleMicClick}
          onDownload={handleDownload}
          hasDownload={!!lastRawAudioBuffer}
        />
      </Footer>
    </Layout>
  );
};

export default App;

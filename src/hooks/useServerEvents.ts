// hooks/useServerEvents.ts
import { useCallback, useRef } from 'react';

export default function useServerEvents(
  isAISpeaking: boolean,
  playAudio: (buf: ArrayBuffer) => Promise<void>,
  stopPlayback: () => void,
  isAIReady: boolean,
  setStatusMessage: (s: string) => void,
  setIsAIReady: (b: boolean) => void,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setCurrentUtterance: React.Dispatch<React.SetStateAction<string>>,
  setLastRawAudioBuffer: React.Dispatch<
    React.SetStateAction<ArrayBuffer | null>
  >
) {
  const currentChunks = useRef<ArrayBuffer[]>([]);

  const handleEvent = useCallback(
    (name: string, data: ServerEventDataBase | ServerEventAIResponseEnd) => {
      switch (name) {
        case 'AIConnected':
          setIsAIReady(true);
          setStatusMessage('AI Ready');
          break;

        case 'AIResponseStart':
          setCurrentUtterance('');
          setStatusMessage('AI Thinking...');
          currentChunks.current = [];
          setLastRawAudioBuffer(null);
          if (isAISpeaking) stopPlayback();
          break;

        case 'AIResponseEnd': {
          const evt = data as ServerEventAIResponseEnd;
          const text = evt.finalText?.trim() || '[Audio only]';
          setMessages((msgs) => [
            ...msgs,
            { id: `ai-${Date.now()}`, sender: 'ai', text, timestamp: Date.now() },
          ]);
          setCurrentUtterance('');
          if (currentChunks.current.length) {
            // concatenate & play
            const total = currentChunks.current.reduce(
              (sum, b) => sum + b.byteLength,
              0
            );
            const buf = new ArrayBuffer(total);
            const v = new Uint8Array(buf);
            let offset = 0;
            for (const c of currentChunks.current) {
              v.set(new Uint8Array(c), offset);
              offset += c.byteLength;
            }
            setLastRawAudioBuffer(buf);
            playAudio(buf).catch((e) => setStatusMessage(`Playback Error: ${e}`));
          } else {
            setStatusMessage(isAIReady ? 'AI Ready' : 'Connecting...');
            setLastRawAudioBuffer(null);
          }
          currentChunks.current = [];
          break;
        }
      }
    },
    [
      isAISpeaking,
      playAudio,
      stopPlayback,
      isAIReady,
      setStatusMessage,
      setIsAIReady,
      setMessages,
      setCurrentUtterance,
      setLastRawAudioBuffer,
    ]
  );

  const handleMessage = useCallback(
    (evt: MessageEvent) => {
      if (typeof evt.data === 'string') {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'event' && msg.name) {
          handleEvent(msg.name, msg);
        } else if (msg.type === 'textDelta') {
          setCurrentUtterance((u) => u + msg.text);
        } else if (msg.type === 'error') {
          setStatusMessage(`Error: ${msg.message}`);
        }
      } else if (evt.data instanceof ArrayBuffer) {
        currentChunks.current.push(evt.data);
      }
    },
    [handleEvent, setCurrentUtterance, setStatusMessage]
  );

  return { handleEvent, handleMessage };
}

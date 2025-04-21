interface ChatMessageProps {
    message: Message;
}

interface Message {
  id: string;
  sender: 'user' | 'ai' | 'system'; // Added 'system' for feedback messages
  text?: string; // Text is now optional
  audioBuffer?: ArrayBuffer; // Store the raw audio data directly
  timestamp: number;
  isPlaying?: boolean;
  playbackProgress?: number;
}

interface ChatMessagesProps {
    messages: Message[];
}

// Define props interface
interface ControlsProps {
    isConnected: boolean;
    isConnecting: boolean;
    isAIReady: boolean;
    isRecording: boolean;
    isPlaying: boolean; // Renamed for consistency
    onConnect: () => void;
    onStartRecording: () => void;
    onStopRecording: () => void;
}

// Define props interface
interface DownloadButtonProps {
    lastRawAudioBuffer: ArrayBuffer | null;
    isPlaying: boolean; // Renamed for consistency
}

// Define props interface
interface StatusBarProps {
    message: string | null;
    isConnected: boolean;
    isAIReady: boolean;
    isRecording: boolean;
    isPlaying: boolean; // Renamed from isPlaying for consistency
}

// Define props interface
interface TranscriptDisplayProps {
    transcript: string;
    currentUtterance: string;
}

interface MicButtonProps {
    isRecording: boolean;
    isConnecting: boolean;
    isConnected: boolean;
    isAIReady: boolean;
    onClick: () => void;
}

type ServerEventDataBase = {
  type: string;
  name: string;
  sessionId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

type ServerEventAIResponseEnd = ServerEventDataBase & {
  name: 'AIResponseEnd';
  finalText?: string;
};

type HandledServerEvent = ServerEventDataBase | ServerEventAIResponseEnd;
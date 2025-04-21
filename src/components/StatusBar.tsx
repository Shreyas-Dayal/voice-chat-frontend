import React from 'react';

export const StatusBar: React.FC<StatusBarProps> = ({
    message,
    isConnected,
    isAIReady,
    isRecording,
    isPlaying
}) => {
    return (
        <div className="status">
            <p>Status: {message || 'Idle'}</p>
            <p>Backend: {isConnected ? 'Connected' : 'Disconnected'}</p>
            <p>AI: {isAIReady ? 'Ready' : 'Not Ready'}</p>
            <p>Mic: {isRecording ? 'RECORDING' : 'Idle'}</p>
            <p>Speaker: {isPlaying ? 'PLAYING' : 'Idle'}</p> {/* Use isPlaying */}
        </div>
    );
}
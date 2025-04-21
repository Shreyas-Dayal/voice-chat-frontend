import React from 'react';

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

export const Controls: React.FC<ControlsProps> = ({
    isConnected,
    isConnecting,
    isAIReady,
    isRecording,
    isPlaying, // Use isPlaying
    onConnect,
    onStartRecording,
    onStopRecording
}) => {
    return (
        <div className="controls">
            {!isConnected && (
                <button onClick={onConnect} disabled={isConnecting}>
                    {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
            )}
            {/* Disable start when AI is speaking */}
            {isConnected && isAIReady && !isRecording && (
                <button onClick={onStartRecording} disabled={!isAIReady || isPlaying}>
                    Start Talking
                </button>
            )}
            {isRecording && (
                <button onClick={onStopRecording} className="stop-button">
                    Stop Talking
                </button>
            )}
        </div>
    );
}
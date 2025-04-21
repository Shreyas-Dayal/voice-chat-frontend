import React from 'react';

// Define props interface
interface TranscriptDisplayProps {
    transcript: string;
    currentUtterance: string;
}

export const TranscriptDisplay: React.FC<TranscriptDisplayProps> = ({
    transcript,
    currentUtterance
}) => {
    return (
        <div className="transcript-container">
            <h2>Conversation</h2>
            <pre className="transcript">{transcript}</pre>
            {currentUtterance && (<p className="current-utterance"><em>AI: {currentUtterance}</em></p>)}
        </div>
    );
}
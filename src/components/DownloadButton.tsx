import React from 'react';

// Keep WAV header function here or import from utils
function addWavHeader(pcmData: ArrayBuffer, sampleRate: number, numChannels: number, bytesPerSample: number): ArrayBuffer {
    // ... (implementation remains the same)
    const dataSize = pcmData.byteLength; const buffer = new ArrayBuffer(44 + dataSize); const view = new DataView(buffer);
    function writeString(view: DataView, offset: number, string: string) { for (let i = 0; i < string.length; i++) { view.setUint8(offset + i, string.charCodeAt(i)); } }
    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true); writeString(view, 36, 'data'); view.setUint32(40, dataSize, true);
    const pcmView = new Uint8Array(pcmData); const dataView = new Uint8Array(buffer, 44); dataView.set(pcmView); return buffer;
}

// Define TARGET_SAMPLE_RATE here or import it
const TARGET_SAMPLE_RATE = 24000;


export const DownloadButton: React.FC<DownloadButtonProps> = ({
    lastRawAudioBuffer,
    isPlaying // Use isPlaying
}) => {

    const handleDownload = () => {
        try {
            if (!lastRawAudioBuffer || lastRawAudioBuffer.byteLength === 0) {
                console.error("Download cancelled: No data available.");
                alert("No audio data available to download for the last response.");
                return;
            }
            const wavBuffer = addWavHeader(lastRawAudioBuffer, TARGET_SAMPLE_RATE, 1, 2);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `response_${Date.now()}.wav`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            console.log(`Triggered download for response audio.`);
        } catch (e) {
            console.error("Error triggering download:", e);
            alert(`Failed to trigger download: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    // Don't show button if no data or AI is speaking
    if (!lastRawAudioBuffer || isPlaying) {
        return null;
    }

    return (
        <div className="controls download-controls">
            <button onClick={handleDownload}>
                Download Last Response (WAV)
            </button>
        </div>
    );
}
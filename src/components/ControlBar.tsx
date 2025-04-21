// src/components/ControlBar.tsx
import React, { CSSProperties } from 'react';
import { Button, Badge, Tooltip, Space, Progress } from 'antd';
import {
  AudioOutlined,
  AudioMutedOutlined,
  // UpCircleOutlined, // Removed
  // DownCircleOutlined, // Removed
  SoundOutlined,
  LoadingOutlined,
  ApiOutlined,
} from '@ant-design/icons';

interface Props {
  isRecording: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  isAIReady: boolean;
  isAISpeaking: boolean;
  statusMessage: string | null;
  onMicClick: () => void;
  isMicMinimized: boolean; // Keep prop if needed for other logic, though toggle is removed
  // toggleMicMinimize: () => void; // Removed Prop
  error: string | null;
}

interface ControlBarStyles {
    container: CSSProperties;
    centerContent: CSSProperties; // New style for centering
    micButton: CSSProperties;
    statusBadge: CSSProperties;
    // toggleButton: CSSProperties; // Removed Style
    // rightSpacer: CSSProperties; // Removed Style
}

const styles: ControlBarStyles = {
    container: {
        width: '100%',
        justifyContent: 'center', // Center the main content now
        padding: '0 20px',
        boxSizing: 'border-box',
    },
    centerContent: {
        // This Space component will contain the button and status
    },
    micButton: {
         // margin: '0 10px' // Example spacing if needed
    },
    statusBadge: {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '180px', // Adjust max width as needed
        marginLeft: '8px', // Add space between button and badge
    },
    // toggleButton style removed
    // rightSpacer style removed
};

export const ControlBar: React.FC<Props> = ({
  isRecording,
  isConnecting,
  isConnected,
  isAIReady,
  isAISpeaking,
  statusMessage,
  onMicClick,
  // isMicMinimized, // Keep if needed elsewhere
  // toggleMicMinimize, // Removed Prop
  error,
}) => {
  // --- Logic to determine icon, text, state (keep as is) ---
    let badgeStatus: 'default' | 'processing' | 'success' | 'warning' | 'error' = 'default';
    let displayText = statusMessage || 'Idle';
    let micIcon: React.ReactNode = <AudioOutlined />;
    let buttonDisabled = false;
    let showProgress = false;
    let micTooltip = 'Start Recording';

    if (isConnecting) { /* ... state logic ... */
        badgeStatus = 'processing'; displayText = 'Connecting...'; micIcon = <LoadingOutlined />; buttonDisabled = true; micTooltip = 'Connecting...';
    } else if (error || !isConnected) { /* ... state logic ... */
        badgeStatus = 'error'; displayText = error || 'Disconnected'; micIcon = <ApiOutlined style={{color: 'red'}}/>; buttonDisabled = true; micTooltip = 'Connection Error';
    } else if (isRecording) { /* ... state logic ... */
        badgeStatus = 'success'; displayText = 'Listening...'; micIcon = <AudioMutedOutlined />; buttonDisabled = false; showProgress = true; micTooltip = 'Stop Recording';
    } else if (isAISpeaking) { /* ... state logic ... */
        badgeStatus = 'processing'; displayText = 'AI Speaking'; micIcon = <SoundOutlined />; buttonDisabled = true; micTooltip = 'AI Speaking';
    } else if (!isAIReady) { /* ... state logic ... */
        badgeStatus = 'warning'; displayText = 'Waiting for AI...'; micIcon = <LoadingOutlined />; buttonDisabled = true; micTooltip = 'AI Not Ready';
    } else { /* ... state logic ... */
        badgeStatus = 'success'; displayText = 'Ready'; micIcon = <AudioOutlined />; buttonDisabled = false; micTooltip = 'Start Recording';
    }

   if (statusMessage && statusMessage !== 'AI Ready' && !isRecording && !isAISpeaking && !isConnecting && isConnected && isAIReady) { /* ... status override ... */
        displayText = statusMessage; if (statusMessage.toLowerCase().includes('error')) badgeStatus = 'error';
   }
  // --- End logic ---

  return (
    // Single Space component centered
    <Space style={styles.container} align="center">
        {/* Removed Left Toggle Button */}

        {/* Center Content: Mic Button and Status */}
        <Space align="center" style={styles.centerContent}>
            <Tooltip title={micTooltip}>
                <Button
                style={styles.micButton}
                type={isRecording ? 'primary' : 'default'}
                danger={isRecording}
                disabled={buttonDisabled}
                shape="circle"
                size="large"
                icon={micIcon}
                onClick={onMicClick}
                />
            </Tooltip>
            <Badge status={badgeStatus} text={<span style={styles.statusBadge}>{displayText}</span>} />
            {showProgress && <Progress type="circle" percent={100} size={20} format={() => ''} status="active" />}
        </Space>

        {/* Removed Right Spacer */}
    </Space>
  );
};
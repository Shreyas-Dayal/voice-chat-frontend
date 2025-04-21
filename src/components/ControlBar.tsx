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
  isMobile: boolean; 
}

// interface ControlBarStyles {
//     container: CSSProperties;
//     centerContent: CSSProperties; // New style for centering
//     micButton: CSSProperties;
//     statusBadge: CSSProperties;
//     // toggleButton: CSSProperties; // Removed Style
//     // rightSpacer: CSSProperties; // Removed Style
// }

// Base styles
const baseStyles = {
    container: {
        width: '100%',
        padding: '0 10px', // Reduced padding for mobile baseline
        boxSizing: 'border-box',
        justifyContent: 'center',
    } as CSSProperties,
    centerContent: {} as CSSProperties,
    micButton: {
         // No specific base style needed now
    } as CSSProperties,
    statusBadgeText: { // Style the text inside the badge
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        marginLeft: '8px',
        verticalAlign: 'middle', // Align text nicely with badge dot
    } as CSSProperties,
};

export const ControlBar: React.FC<Props> = ({
  isRecording,
  isConnecting,
  isConnected,
  isAIReady,
  isAISpeaking,
  statusMessage,
  onMicClick,
  isMobile,
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

  // --- Responsive Styles ---
  const dynamicStyles = {
        statusBadgeText: {
            ...baseStyles.statusBadgeText,
            maxWidth: isMobile ? '100px' : '180px', // Shorter text area on mobile
            display: isMobile ? 'none' : 'inline-block', // Hide text on mobile
        },
        // micButtonSize: isMobile ? 'default' : 'large', // Smaller button on mobile
        micButtonSize: isMobile ? 'middle' : 'large', // Smaller button on mobile
        progressSize: isMobile ? 16 : 20, // Smaller progress on mobile
  };

  return (
    // Use wrap on the outer Space for responsiveness
    <Space style={baseStyles.container} align="center" wrap={isMobile}>
        {/* Center Content: Mic Button and Status */}
        {/* Use another Space for items that should stay together */}
        <Space align="center" style={baseStyles.centerContent}>
            <Tooltip title={micTooltip}>
              <Button
              style={baseStyles.micButton}
              type={isRecording ? 'primary' : 'default'}
              danger={isRecording}
              disabled={buttonDisabled}
              shape="circle"
              size={dynamicStyles.micButtonSize as 'small' | 'middle' | 'large' | undefined} 
              icon={micIcon}
              onClick={onMicClick}
              />
            </Tooltip>
            {/* Badge: Conditionally render text span based on mobile */}
            <Badge
                status={badgeStatus}
                text={!isMobile ? <span style={dynamicStyles.statusBadgeText}>{displayText}</span> : null} // Hide text on mobile
            />
            {/* Tooltip for Badge text on mobile */}
            {isMobile && <Tooltip title={displayText}><span style={{marginLeft: '4px'}}>({badgeStatus === 'success' ? '✓' : badgeStatus === 'processing' ? '...' : '!'})</span></Tooltip> }

            {showProgress && <Progress type="circle" percent={100} size={dynamicStyles.progressSize} format={() => ''} status="active" />}
        </Space>
    </Space>
  );
};
// src/components/MaximizedView.tsx
import React, { CSSProperties } from 'react';
import { Button, Typography, Spin, Tooltip } from 'antd';
import {
  AudioOutlined,
  SoundOutlined,
  LoadingOutlined,
  ApiOutlined,
  // DownCircleOutlined, // Removed
} from '@ant-design/icons';

interface MaximizedViewProps {
  isRecording: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  isAIReady: boolean;
  isAISpeaking: boolean;
  statusMessage: string | null;
  onMicClick: () => void;
  // toggleMicMinimize: () => void; // Removed Prop
  error: string | null;
}

interface Styles {
  container: CSSProperties;
  micButtonBase: CSSProperties;
  micButtonRecording: CSSProperties;
  primaryText: CSSProperties;
  secondaryText: CSSProperties;
  // minimizeButton: CSSProperties; // Removed Style
  // minimizeButtonIcon: CSSProperties; // Removed Style
  liveTranscriptPlaceholder: CSSProperties;
  aiSpeakingIconSpin: CSSProperties;
}

const styles: Styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    textAlign: 'center',
    padding: '20px',
    position: 'relative', // Keep relative if needed for other absolute elements inside
    // backgroundColor: '#fdfdfd', // Optional background
  },
  micButtonBase: {
    width: '160px',
    height: '160px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    transition: 'box-shadow 0.3s ease-in-out, background-color 0.3s ease-in-out, border-color 0.3s ease-in-out',
  },
  micButtonRecording: {
    boxShadow: '0 6px 16px rgba(255, 82, 82, 0.3)',
  },
  primaryText: {
    marginTop: '30px',
    marginBottom: '10px',
    fontWeight: 500,
  },
  secondaryText: {
    color: '#888',
  },
  // minimizeButton style removed
  // minimizeButtonIcon style removed
  liveTranscriptPlaceholder: {
    marginTop: '20px',
    minHeight: '2em',
    color: '#777',
    fontStyle: 'italic',
  },
  aiSpeakingIconSpin: {},
};

const pulseKeyframes = `
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.7); } 70% { box-shadow: 0 0 0 20px rgba(255, 82, 82, 0); } 100% { box-shadow: 0 0 0 0 rgba(255, 82, 82, 0); } }
  .mic-button-pulsing { animation: pulse 1.8s infinite; }
`;

export const MaximizedView: React.FC<MaximizedViewProps> = ({
  isRecording,
  isConnecting,
  isConnected,
  isAIReady,
  isAISpeaking,
  onMicClick,
  // toggleMicMinimize, // Removed Prop
  error,
}) => {
  // --- Logic to determine icon, text, state (keep as is) ---
  let icon: React.ReactNode = <AudioOutlined />;
  let primaryText: string = 'Tap the microphone to start speaking';
  let secondaryText: string | React.ReactNode = 'Ready'; // Default secondary text
  let buttonType: 'primary' | 'default' = 'default';
  let buttonDanger = false;
  let showPulseClass = false;
  let showSpinAroundIcon = false;
  let buttonDisabled = false;
  let tooltipTitle = 'Start Recording';
  const micIconStyle: CSSProperties = { fontSize: '64px' };

  if (isConnecting) { /* ... state logic ... */
    icon = <LoadingOutlined />; primaryText = 'Connecting...'; secondaryText = 'Please wait.'; buttonDisabled = true; tooltipTitle = 'Connecting...';
  } else if (error || !isConnected) { /* ... state logic ... */
    icon = <ApiOutlined style={{ color: 'red' }} />; primaryText = 'Connection Error'; secondaryText = error || 'Could not connect.'; buttonDisabled = true; tooltipTitle = 'Connection Error';
  } else if (isRecording) { /* ... state logic ... */
    icon = <AudioOutlined />; primaryText = 'Listening...'; secondaryText = 'Tap microphone to stop'; buttonType = 'primary'; buttonDanger = true; showPulseClass = true; tooltipTitle = 'Stop Recording';
  } else if (isAISpeaking) { /* ... state logic ... */
    icon = <SoundOutlined />; primaryText = 'AI is speaking...'; secondaryText = '\u00A0'; showSpinAroundIcon = true; buttonDisabled = true; tooltipTitle = 'AI Speaking';
  } else if (!isAIReady) { /* ... state logic ... */
    icon = <LoadingOutlined />; primaryText = 'Waiting for AI service...'; secondaryText = 'Connected, AI initializing.'; buttonDisabled = true; tooltipTitle = 'AI Not Ready';
  } else { /* ... state logic ... */
    icon = <AudioOutlined />; primaryText = 'Tap microphone to start speaking'; secondaryText = 'Ready'; buttonDisabled = false; tooltipTitle = 'Start Recording';
  }
  // --- End logic ---

  const micButtonStyle = {
    ...styles.micButtonBase,
    ...(isRecording ? styles.micButtonRecording : {}),
  };

  return (
    <div style={styles.container}>
      <style>{pulseKeyframes}</style>

      <Tooltip title={tooltipTitle}>
        <Button
          className={showPulseClass ? 'mic-button-pulsing' : ''}
          style={micButtonStyle}
          type={buttonType}
          danger={buttonDanger}
          disabled={buttonDisabled}
          shape="circle"
          icon={
            showSpinAroundIcon ? (
              // Use LoadingOutlined within Spin for consistency
              <Spin size="large" indicator={<LoadingOutlined style={micIconStyle} spin />} style={styles.aiSpeakingIconSpin} />
            ) : (
               // Ensure icon is typed correctly for cloneElement
              React.cloneElement(icon as React.ReactElement<{ style?: CSSProperties }>, {
                style: micIconStyle,
              })
            )
          }
          onClick={onMicClick}
        />
      </Tooltip>

      <Typography.Title level={3} style={styles.primaryText}>
        {primaryText}
      </Typography.Title>
      <Typography.Text style={styles.secondaryText}>{secondaryText}</Typography.Text>

      {/* Minimize Button Removed */}

      {isRecording && (
        <div style={styles.liveTranscriptPlaceholder}>
          <Typography.Text>(Listening...)</Typography.Text>
        </div>
      )}
    </div>
  );
};
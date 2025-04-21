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
  isMobile: boolean; // Added Prop
}

// interface Styles {
//   container: CSSProperties;
//   micButtonBase: CSSProperties;
//   micButtonRecording: CSSProperties;
//   primaryText: CSSProperties;
//   secondaryText: CSSProperties;
//   // minimizeButton: CSSProperties; // Removed Style
//   // minimizeButtonIcon: CSSProperties; // Removed Style
//   liveTranscriptPlaceholder: CSSProperties;
//   aiSpeakingIconSpin: CSSProperties;
//   isMobile: boolean; 
// }

// Define base styles that don't change with mobile/theme
const baseStyles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    textAlign: 'center',
    padding: '15px', // Reduced padding slightly
    position: 'relative',
  } as CSSProperties,
  micButtonBase: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    transition: 'box-shadow 0.3s ease-in-out, background-color 0.3s ease-in-out, border-color 0.3s ease-in-out, width 0.3s ease, height 0.3s ease', // Added width/height transition
  } as CSSProperties,
  micButtonRecording: {
    boxShadow: '0 6px 16px rgba(255, 82, 82, 0.3)',
  } as CSSProperties,
  primaryText: {
    marginTop: '25px', // Adjusted margin
    marginBottom: '8px', // Adjusted margin
    fontWeight: 500,
    transition: 'font-size 0.3s ease',
  } as CSSProperties,
  secondaryText: {
    color: 'var(--ant-text-color-secondary)', // Use theme variable
    transition: 'font-size 0.3s ease',
    minHeight: '1.2em', // Prevent layout shift when text changes
  } as CSSProperties,
  liveTranscriptPlaceholder: {
    marginTop: '15px',
    minHeight: '1.5em',
    color: 'var(--ant-text-color-secondary)', // Use theme variable
    fontStyle: 'italic',
  } as CSSProperties,
  aiSpeakingIconSpin: {} as CSSProperties,
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
  isMobile,
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
//   const micIconStyle: CSSProperties = { fontSize: '64px' };

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

//   const micButtonStyle = {
//     ...styles.micButtonBase,
//     ...(isRecording ? styles.micButtonRecording : {}),
//   };

  // --- Responsive Styles ---
  const dynamicStyles = {
      micButton: {
          ...baseStyles.micButtonBase,
          width: isMobile ? '120px' : '160px', // Smaller button on mobile
          height: isMobile ? '120px' : '160px',
          ...(isRecording ? baseStyles.micButtonRecording : {}),
      },
      micIcon: {
          fontSize: isMobile ? '48px' : '64px', // Smaller icon on mobile
      },
      primaryText: {
          ...baseStyles.primaryText,
          fontSize: isMobile ? '1.1rem' : '1.5rem', // Smaller text on mobile (adjust as needed)
      },
      secondaryText: {
          ...baseStyles.secondaryText,
          fontSize: isMobile ? '0.85rem' : '1rem', // Smaller text on mobile
      }
  };
  // --- End Responsive Styles ---

  return (
    <div style={baseStyles.container}>
      <style>{pulseKeyframes}</style>

      <Tooltip title={tooltipTitle}>
        <Button
          className={showPulseClass ? 'mic-button-pulsing' : ''}
          style={dynamicStyles.micButton} // Apply dynamic button style
          type={buttonType}
          danger={buttonDanger}
          disabled={buttonDisabled}
          shape="circle"
          icon={
            showSpinAroundIcon ? (
              <Spin size="large" indicator={<LoadingOutlined style={dynamicStyles.micIcon} spin />} style={baseStyles.aiSpeakingIconSpin} />
            ) : (
              React.cloneElement(icon as React.ReactElement<{ style?: CSSProperties }>, {
                style: dynamicStyles.micIcon, // Apply dynamic icon style
              })
            )
          }
          onClick={onMicClick}
        />
      </Tooltip>

      <Typography.Title level={isMobile ? 4 : 3} style={dynamicStyles.primaryText}> {/* Adjust heading level too */}
        {primaryText}
      </Typography.Title>
      <Typography.Text style={dynamicStyles.secondaryText}>{secondaryText}</Typography.Text>

      {isRecording && (
        <div style={baseStyles.liveTranscriptPlaceholder}>
          <Typography.Text>(Listening...)</Typography.Text>
        </div>
      )}
    </div>
  );
};
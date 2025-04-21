// src/components/MaximizedView.tsx
import React, { CSSProperties } from 'react';
import { Button, Typography, Spin, Tooltip } from 'antd';
import {
  AudioOutlined,
  SoundOutlined,
  LoadingOutlined,
  ApiOutlined,
  DownCircleOutlined,
} from '@ant-design/icons';

interface MaximizedViewProps {
  isRecording: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  isAIReady: boolean;
  isAISpeaking: boolean;
  statusMessage: string | null;
  onMicClick: () => void;
  toggleMicMinimize: () => void;
  error: string | null;
}

interface Styles {
  container: CSSProperties;
  micButtonBase: CSSProperties;
  micButtonRecording: CSSProperties;
  primaryText: CSSProperties;
  secondaryText: CSSProperties;
  minimizeButton: CSSProperties;
  minimizeButtonIcon: CSSProperties;
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
    position: 'relative',
    backgroundColor: '#fdfdfd',
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
  minimizeButton: {
    position: 'absolute',
    bottom: '25px',
    right: '25px',
    color: '#aaa',
  },
  minimizeButtonIcon: {
    fontSize: '24px',
  },
  liveTranscriptPlaceholder: {
    marginTop: '20px',
    minHeight: '2em',
    color: '#777',
    fontStyle: 'italic',
  },
  aiSpeakingIconSpin: {},
};

const pulseKeyframes = `
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.7);
    }
    70% {
      box-shadow: 0 0 0 20px rgba(255, 82, 82, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(255, 82, 82, 0);
    }
  }

  .mic-button-pulsing {
    animation: pulse 1.8s infinite;
  }
`;

export const MaximizedView: React.FC<MaximizedViewProps> = ({
  isRecording,
  isConnecting,
  isConnected,
  isAIReady,
  isAISpeaking,
  onMicClick,
  toggleMicMinimize,
  error,
}) => {
  let icon: React.ReactNode = <AudioOutlined />;
  let primaryText: string = 'Tap the microphone to start speaking';
  let secondaryText: string | React.ReactNode =
    'Tap the minimize button below to view conversation history';
  let buttonType: 'primary' | 'default' = 'default';
  let buttonDanger = false;
  let showPulseClass = false;
  let showSpinAroundIcon = false;
  let buttonDisabled = false;
  let tooltipTitle = 'Start Recording';
  const micIconStyle: CSSProperties = { fontSize: '64px' };

  if (isConnecting) {
    icon = <LoadingOutlined />;
    primaryText = 'Connecting to backend...';
    secondaryText = 'Please wait.';
    buttonDisabled = true;
    tooltipTitle = 'Connecting...';
  } else if (error || !isConnected) {
    icon = <ApiOutlined style={{ color: 'red' }} />;
    primaryText = 'Connection Error';
    secondaryText = error || 'Could not connect. Please check the backend or refresh.';
    buttonDisabled = true;
    tooltipTitle = 'Connection Error';
  } else if (isRecording) {
    icon = <AudioOutlined />;
    primaryText = 'Listening...';
    secondaryText = 'Tap the microphone to stop';
    buttonType = 'primary';
    buttonDanger = true;
    showPulseClass = true;
    tooltipTitle = 'Stop Recording';
  } else if (isAISpeaking) {
    icon = <SoundOutlined />;
    primaryText = 'AI is speaking...';
    secondaryText = '\u00A0';
    showSpinAroundIcon = true;
    buttonDisabled = true;
    tooltipTitle = 'AI Speaking';
  } else if (!isAIReady) {
    icon = <LoadingOutlined />;
    primaryText = 'Waiting for AI service...';
    secondaryText = 'The connection is established, but the AI is not ready yet.';
    buttonDisabled = true;
    tooltipTitle = 'AI Not Ready';
  } else {
    icon = <AudioOutlined />;
    primaryText = 'Tap the microphone to start speaking';
    secondaryText = 'Tap the minimize button below to view conversation history';
    buttonDisabled = false;
    tooltipTitle = 'Start Recording';
  }

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
              <Spin size="large" indicator={<LoadingOutlined style={micIconStyle} />} style={styles.aiSpeakingIconSpin} />
            ) : (
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

      <Tooltip title="View Conversation History">
        <Button
          style={styles.minimizeButton}
          type="text"
          icon={<DownCircleOutlined style={styles.minimizeButtonIcon} />}
          onClick={toggleMicMinimize}
          disabled={isConnecting || !isConnected}
        />
      </Tooltip>

      {isRecording && (
        <div style={styles.liveTranscriptPlaceholder}>
          <Typography.Text>(Listening...)</Typography.Text>
        </div>
      )}
    </div>
  );
};

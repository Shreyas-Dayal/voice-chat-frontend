// src/components/ControlBar.tsx
import React, { CSSProperties } from 'react';
import { Button, Badge, Tooltip, Space, Progress } from 'antd';
import {
  AudioOutlined,
  AudioMutedOutlined,
  UpCircleOutlined,
  DownCircleOutlined, // Added for consistency
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
  isMicMinimized: boolean;
  toggleMicMinimize: () => void;
  error: string | null;
}

interface ControlBarStyles {
  container: CSSProperties;
  micButton: CSSProperties;
  statusBadge: CSSProperties;
  toggleButton: CSSProperties;
  rightSpacer: CSSProperties;
}

const styles: ControlBarStyles = {
  container: {
    width: '100%',
    justifyContent: 'space-between',
    padding: '0 20px',
    boxSizing: 'border-box',
  },
  micButton: {},
  statusBadge: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '150px',
  },
  toggleButton: {
    fontSize: '20px',
  },
  rightSpacer: {
    width: '40px',
    visibility: 'hidden',
  }
};

export const ControlBar: React.FC<Props> = ({
  isRecording,
  isConnecting,
  isConnected,
  isAIReady,
  isAISpeaking,
  statusMessage,
  onMicClick,
  isMicMinimized,
  toggleMicMinimize,
  error,
}) => {
  let badgeStatus: 'default' | 'processing' | 'success' | 'warning' | 'error' = 'default';
  let displayText = statusMessage || 'Idle';
  let micIcon: React.ReactNode = <AudioOutlined />;
  let buttonDisabled = false;
  let showProgress = false;
  let micTooltip = 'Start Recording';

  if (isConnecting) {
    badgeStatus = 'processing';
    displayText = 'Connecting...';
    micIcon = <LoadingOutlined />;
    buttonDisabled = true;
    micTooltip = 'Connecting...';
  } else if (error || !isConnected) {
    badgeStatus = 'error';
    displayText = error || 'Disconnected';
    micIcon = <ApiOutlined style={{ color: 'red' }} />;
    buttonDisabled = true;
    micTooltip = 'Connection Error';
  } else if (isRecording) {
    badgeStatus = 'success';
    displayText = 'Listening...';
    micIcon = <AudioMutedOutlined />;
    buttonDisabled = false;
    showProgress = true;
    micTooltip = 'Stop Recording';
  } else if (isAISpeaking) {
    badgeStatus = 'processing';
    displayText = 'AI Speaking';
    micIcon = <SoundOutlined />;
    buttonDisabled = true;
    micTooltip = 'AI Speaking';
  } else if (!isAIReady) {
    badgeStatus = 'warning';
    displayText = 'Waiting for AI...';
    micIcon = <LoadingOutlined />;
    buttonDisabled = true;
    micTooltip = 'AI Not Ready';
  } else {
    badgeStatus = 'success';
    displayText = 'Ready';
    micIcon = <AudioOutlined />;
    buttonDisabled = false;
    micTooltip = 'Start Recording';
  }

  if (statusMessage && statusMessage !== 'AI Ready' && !isRecording && !isAISpeaking && !isConnecting && isConnected && isAIReady) {
    displayText = statusMessage;
    if (statusMessage.toLowerCase().includes('error')) {
      badgeStatus = 'error';
    }
  }

  return (
    <Space style={styles.container} align="center">
      <Tooltip title={isMicMinimized ? "Maximize View" : "Minimize to Chat"}>
        <Button
          onClick={toggleMicMinimize}
          type="text"
          size="large"
          style={styles.toggleButton}
          icon={isMicMinimized ? <UpCircleOutlined /> : <DownCircleOutlined />}
          disabled={isConnecting || !isConnected}
        />
      </Tooltip>

      <Space align="center">
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

      <div style={styles.rightSpacer}></div>
    </Space>
  );
};

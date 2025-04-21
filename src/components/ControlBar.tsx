// components/ControlBar.tsx
import React from 'react';
import { Button, Badge, Tooltip, Space, Progress } from 'antd';
import {
  AudioOutlined,
  AudioMutedOutlined,
  DownloadOutlined,
} from '@ant-design/icons';

interface Props {
  isRecording: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  isAIReady: boolean;
  isAISpeaking: boolean;
  statusMessage: string | null;
  onMicClick: () => void;
  onDownload: () => void;
  hasDownload: boolean;
}

export const ControlBar: React.FC<Props> = ({
  isRecording,
  isConnecting,
  isConnected,
  isAIReady,
  isAISpeaking,
  statusMessage,
  onMicClick,
  onDownload,
  hasDownload,
}) => {
  // Determine badge status
  let badgeStatus: 'default' | 'processing' | 'success' | 'warning' | 'error' = 'default';
  let displayText = statusMessage || 'Idle';

  if (isConnecting) {
    badgeStatus = 'processing';
    displayText = 'Connecting';
  } else if (!isConnected) {
    badgeStatus = 'error';
    displayText = 'Disconnected';
  } else if (isRecording) {
    badgeStatus = 'success';
    displayText = 'Listening';
  } else if (isAISpeaking) {
    badgeStatus = 'processing';
    displayText = 'AI Speaking';
  } else if (statusMessage === 'AI Ready') {
    badgeStatus = 'success';
    displayText = 'Ready';
  } else if (statusMessage?.includes('Error')) {
    badgeStatus = 'error';
  }

  return (
    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
      <Space>
        <Tooltip title={isRecording ? 'Stop Recording' : 'Start Recording'}>
          <Button
            type={isRecording ? 'primary' : 'default'}
            danger={isRecording}
            disabled={isConnecting || !isConnected || !isAIReady}
            shape="circle"
            size="large"
            icon={isRecording ? <AudioMutedOutlined /> : <AudioOutlined />}
            onClick={onMicClick}
          />
        </Tooltip>

        <Badge status={badgeStatus} text={displayText} />

        {isRecording && <Progress style={{ width: 40 }} percent={100} size="small" status="active" />}
      </Space>

      {hasDownload && !isAISpeaking && (
        <Tooltip title="Download last response">
          <Button
            type="default"
            shape="circle"
            icon={<DownloadOutlined />}
            onClick={onDownload}
          />
        </Tooltip>
      )}
    </Space>
  );
};

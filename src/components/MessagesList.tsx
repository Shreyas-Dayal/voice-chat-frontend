import React, { useEffect, useRef } from 'react';
import { Avatar, Typography } from 'antd';

interface Props {
  messages: Message[];
  isMicMinimized: boolean;
}

export const MessagesList: React.FC<Props> = ({ messages }) => {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Dynamically adjusting bubble styles for light and dark mode
  const bubbleStyles = {
    user: {
      background: 'var(--ant-color-primary)', // user message: primary color
      color: 'var(--ant-color-white)',        // white text for user
      alignSelf: 'flex-end',
    },
    ai: {
      background: 'var(--ant-color-bg-container)', // ai message: background for containers
      color: 'var(--ant-color-text)',              // text color for AI
      alignSelf: 'flex-start',
    },
    system: {
      background: 'var(--ant-color-bg-container)', // system message: container background
      color: 'var(--ant-color-text-secondary)',    // secondary text color for system
      alignSelf: 'center',
    },
  };

  return (
    <div
      style={{
        height: 'calc(100% - 2rem)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {messages.map((msg) => {
        const isUser = msg.sender === 'user';
        return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              flexDirection: isUser ? 'row-reverse' : 'row',
            }}
          >
            <Avatar style={{ background: isUser ? 'var(--ant-color-primary)' : '#bbb' }}>
              {isUser ? 'You' : 'AI'}
            </Avatar>
            <div
              style={{
                ...bubbleStyles[msg.sender],
                padding: '0.5rem 1rem',
                borderRadius: 16,
                margin: '0 0.5rem',
                maxWidth: '70%',
              }}
            >
              <Typography.Text>{msg.text}</Typography.Text>
              <Typography.Text
                type="secondary"
                style={{ display: 'block', fontSize: '0.75rem', marginTop: 4 }}
              >
                {`${Math.round((Date.now() - msg.timestamp) / 1000)}s ago`}
              </Typography.Text>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};

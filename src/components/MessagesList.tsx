// components/MessagesList.tsx
import React, { useEffect, useRef } from 'react';
import { Avatar, Typography } from 'antd';

interface Props {
  messages: Message[];
}

const bubbleStyles = {
  user: {
    background: '#1890ff',
    color: '#fff',
    alignSelf: 'flex-end',
  },
  ai: {
    background: '#f0f0f0',
    color: '#000',
    alignSelf: 'flex-start',
  },
  system: {
    background: '#e6f7ff',
    color: '#333',
    alignSelf: 'center',
  },
};

export const MessagesList: React.FC<Props> = ({ messages }) => {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
            <Avatar style={{ background: isUser ? '#096dd9' : '#bbb' }}>
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

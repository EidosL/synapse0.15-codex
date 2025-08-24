import React, { useEffect, useRef } from 'react';

import { useLogStore } from '../lib/logStore';


export const ThinkingStatus: React.FC<{ messages: string[]; onClose?: () => void }> = ({ messages, onClose }) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const exportThinkingSteps = useLogStore(state => state.exportThinkingSteps);


    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);
    if (messages.length === 0) return null;

    const completedMessages = messages.slice(0, -1);
    const currentMessage = messages[messages.length - 1];

    return (
        <div className="thinking-status-overlay">
            <div className="thinking-status-content">
                <div className="thinking-status-header">
                    <h3>🧠 Synapse is Thinking...</h3>
                    <button onClick={exportThinkingSteps}>Download log</button>
                </div>
                <ul className="thinking-status-log">
                    {completedMessages.map((msg, index) => (
                        <li key={index} className="completed">
                            <span className="icon">✅</span>
                            <span>{msg}</span>
                        </li>
                    ))}
                    {currentMessage && (
                         <li className="in-progress">
                             <span className="icon"><div className="spinner"></div></span>
                             <span>{currentMessage}</span>
                        </li>
                    )}
                </ul>
                <div ref={messagesEndRef} />
            </div>
        </div>
    );
};

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { MessageRenderer } from './MessageRenderer';
import { SourceCard } from './SourceCard';
import { StatChart, type StatChartData } from './StatChart';
import { MessageActions } from './MessageActions';

interface Source {
  title: string;
  similarity: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  statData?: StatChartData;
}

interface ChatInterfaceProps {
  /** 当前会话 ID（null 表示尚未创建会话） */
  conversationId: string | null;
  /** 当前会话的消息列表（受控，由父组件管理） */
  messages: Message[];
  /** 消息变化回调 */
  onMessagesChange: (messages: Message[]) => void;
}

function parseDataLine(line: string): { type: string; value: string } | null {
  if (!line) return null;
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;
  const type = line.substring(0, colonIndex);
  const valueStr = line.substring(colonIndex + 1);
  try {
    const value = JSON.parse(valueStr);
    return { type, value };
  } catch {
    return null;
  }
}

export function ChatInterface({
  conversationId,
  messages,
  onMessagesChange,
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 流式生成中已显示的文本。用 state 驱动，使回答在生成过程中就实时渲染 Markdown
  // （而非等全部生成完再切到 Markdown 视图）
  const [streamingText, setStreamingText] = useState('');
  // 是否跟随底部自动滚动。用户主动向上滚动查看历史时置为 false，
  // 暂停自动滚动（打字机不会被强制拉回底部）；滚回底部后自动恢复。
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    // 仅在用户停留在底部附近时自动滚动到底部
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  /** 跟踪用户滚动位置：离开底部（向上翻看）则暂停自动滚动 */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 60;
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: text };
    const assistantMessage: Message = { role: 'assistant', content: '' };

    // 用户主动发送新消息 → 先恢复"跟随底部"，再更新消息，
    // 保证渲染后的滚动 effect 一定生效（否则若之前向上滚过会停在原地看不到新回答）
    stickToBottomRef.current = true;
    flushSync(() => {
      onMessagesChange([...messages, userMessage, assistantMessage]);
      setInput('');
      setIsLoading(true);
      setError(null);
    });

    // 双保险：强制滚动到底部，让新问题与回答立即可见
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });

    const controller = new AbortController();
    abortRef.current = controller;

    // 提升作用域，便于停止/报错时清理打字机 interval，避免泄漏
    let typewriter: number | null = null;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          conversationId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const sourcesHeader = response.headers.get('X-Search-Results');
      let sources: Source[] = [];
      if (sourcesHeader) {
        try {
          sources = JSON.parse(decodeURIComponent(sourcesHeader));
        } catch {
          // ignore parse errors
        }
      }

      // 统计问答的图表数据（结构化分组数据，用于渲染柱状图/折线图）
      const statDataHeader = response.headers.get('X-Stat-Data');
      let statData: StatChartData | undefined;
      if (statDataHeader) {
        try {
          statData = JSON.parse(decodeURIComponent(statDataHeader));
        } catch {
          // ignore parse errors
        }
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let displayedLen = 0;
      let streamDone = false;

      // 打字机：间隔稍放宽（约 20 帧/秒），每次用 state 更新已显示文本，
      // 让 react-markdown 在生成过程中就实时渲染（表格、列表、代码块等）
      typewriter = window.setInterval(() => {
        if (displayedLen >= fullText.length) {
          if (streamDone) {
            if (typewriter !== null) window.clearInterval(typewriter);
            flushSync(() => {
              setStreamingText('');
              onMessagesChange(
                (() => {
                  const updated = [...messages];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: fullText,
                    sources: sources.length > 0 ? sources : undefined,
                    statData,
                  };
                  return updated;
                })()
              );
              setIsLoading(false);
            });
          }
          return;
        }

        displayedLen = Math.min(fullText.length, displayedLen + 6);

        // 仅当用户停留在底部附近时才跟随滚动，避免打断用户向上翻看
        if (stickToBottomRef.current) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }

        setStreamingText(fullText.substring(0, displayedLen));
      }, 50);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) continue;
          const parsed = parseDataLine(line);
          if (parsed && parsed.type === '0') {
            fullText += parsed.value;
          }
        }
      }

      streamDone = true;
    } catch (err) {
      // 停止或报错时清理打字机 interval，并清空流式文本
      if (typewriter !== null) window.clearInterval(typewriter);
      setStreamingText('');
      if (err instanceof DOMException && err.name === 'AbortError') {
        // user cancelled
      } else {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      flushSync(() => setIsLoading(false));
    }
    abortRef.current = null;
  }, [conversationId, messages, isLoading, onMessagesChange]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.trim() && !isLoading) {
          sendMessage(input);
        }
      }
    },
    [input, isLoading, sendMessage]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        sendMessage(input);
      }
    },
    [input, isLoading, sendMessage]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="flex-1 overflow-y-auto" ref={scrollRef} onScroll={handleScroll}>
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-4 4v-4z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-2">知识库问答</h2>
              <p className="text-sm text-muted max-w-md">
                基于已上传的文档进行问答。系统会自动检索相关内容并生成回答，同时标注引用来源。
              </p>
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
                {[
                  '这个文档的核心观点是什么？',
                  '总结主要内容的要点',
                  '有哪些关键结论？',
                  '请列出文档中的关键数据',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-left p-3 rounded-xl border border-border bg-surface hover:border-primary hover:bg-surface-hover transition-all text-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, i) => {
            const isStreaming = isLoading && i === messages.length - 1;
            return (
              <div
                key={i}
                className={`flex gap-3 mb-6 animate-fade-in ${
                  message.role === 'user' ? 'flex-row-reverse' : ''
                }`}
              >
                <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium ${
                  message.role === 'user'
                    ? 'bg-foreground text-background'
                    : 'bg-primary text-white'
                }`}>
                  {message.role === 'user' ? '我' : 'AI'}
                </div>

                <div className={`flex-1 min-w-0 ${message.role === 'user' ? 'flex flex-col items-end' : ''}`}>
                  <div
                    className={`inline-block max-w-full rounded-2xl px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-primary text-white'
                        : 'bg-surface border border-border'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                    ) : isStreaming ? (
                      // 生成中即渲染 Markdown（表格/列表/代码块实时成形），并带打字光标
                      <MessageRenderer content={streamingText} streaming />
                    ) : (
                      <>
                        <MessageRenderer content={message.content} />
                        {message.statData && <StatChart data={message.statData} />}
                        {message.sources && <SourceCard sources={message.sources} />}
                      </>
                    )}
                  </div>

                  {message.role === 'assistant' && !isLoading && (
                    <MessageActions
                      content={message.content}
                      question={
                        i > 0 && messages[i - 1]?.role === 'user'
                          ? messages[i - 1].content
                          : undefined
                      }
                      className="mt-1.5"
                    />
                  )}
                </div>
              </div>
            );
          })}

          {error && (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm mb-6">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>请求失败: {error.message}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border bg-surface">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="基于知识库提问... (Enter 发送, Shift+Enter 换行)"
                rows={1}
                disabled={isLoading}
                className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm placeholder:text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all disabled:opacity-60"
                style={{ maxHeight: '200px' }}
              />
            </div>
            {isLoading ? (
              <button
                type="button"
                onClick={stop}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                title="停止生成"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="发送"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            )}
          </form>
          <div className="text-xs text-muted text-center mt-2">
            AI 回答基于知识库内容，仅供参考。请始终验证重要信息。
          </div>
        </div>
      </div>
    </div>
  );
}

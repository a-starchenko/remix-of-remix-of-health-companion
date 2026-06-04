import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { UserDropdown } from '@/components/layout/UserDropdown';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { MarkdownMessage } from '@/components/chat/MarkdownMessage';
import { ChatHistorySidebar } from '@/components/chat/ChatHistorySidebar';
import { Send, Loader2, History, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hi! Ask me anything. I'll answer in formatted markdown (with tables when useful). If you've uploaded files to your knowledge base in **Account → Profile**, I'll use them to ground my answers.",
};

const ChatView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [inputValue, setInputValue] = useState('');
  const [historyOpen, setHistoryOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const hasAutoSelected = useRef(false);
  const sentInitialPrompt = useRef(false);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      toast.error('Failed to load conversations');
    } else {
      setConversations((data ?? []) as Conversation[]);
    }
    setConversationsLoading(false);
  }, [user]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setMessagesLoading(true);
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('Failed to load messages');
      setMessagesLoading(false);
      return;
    }
    const msgs: Message[] = (data ?? []).map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    setMessages(msgs.length > 0 ? msgs : [WELCOME_MESSAGE]);
    setMessagesLoading(false);
  }, []);

  useEffect(() => {
    if (user) loadConversations();
  }, [user, loadConversations]);

  // Auto-select first conversation once on initial load
  useEffect(() => {
    if (conversationsLoading || hasAutoSelected.current) return;
    hasAutoSelected.current = true;
    if (conversations.length > 0) {
      const first = conversations[0];
      setActiveConversationId(first.id);
      loadMessages(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationsLoading]);

  // Send initialPrompt from navigation state (after conversations load)
  useEffect(() => {
    const initialPrompt = location.state?.initialPrompt as string | undefined;
    if (initialPrompt && !conversationsLoading && !sentInitialPrompt.current) {
      sentInitialPrompt.current = true;
      handleSendMessage(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationsLoading]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSelectSession = async (id: string) => {
    if (id === activeConversationId) return;
    setActiveConversationId(id);
    await loadMessages(id);
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setMessages([WELCOME_MESSAGE]);
  };

  const handleSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const tempId = `tmp-${Date.now()}`;
    const userMessage: Message = { id: tempId, role: 'user', content: trimmed };

    // Strip welcome message from history sent to AI / persisted
    const history = messages.filter((m) => m.id !== 'welcome');
    const nextMessages = [...history, userMessage];

    setMessages(nextMessages);
    setInputValue('');
    setIsLoading(true);

    try {
      // Create conversation on first message in a new chat
      let convId = activeConversationId;
      if (!convId) {
        const title = trimmed.slice(0, 60);
        const { data: conv, error: convErr } = await supabase
          .from('conversations')
          .insert({ user_id: user!.id, title })
          .select()
          .single();
        if (convErr) throw convErr;
        convId = conv.id;
        setActiveConversationId(convId);
        setConversations((prev) => [conv as Conversation, ...prev]);
      }

      // Save user message
      const { data: savedUser, error: umErr } = await supabase
        .from('messages')
        .insert({ conversation_id: convId, user_id: user!.id, role: 'user', content: trimmed })
        .select()
        .single();
      if (umErr) throw umErr;

      // Replace temp id with real id
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: savedUser.id } : m)));

      // Update conversation title if this is the very first user message
      if (history.length === 0) {
        const newTitle = trimmed.slice(0, 60);
        await supabase
          .from('conversations')
          .update({ title: newTitle, updated_at: new Date().toISOString() })
          .eq('id', convId);
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, title: newTitle } : c))
        );
      }

      // Call the AI
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const reply: string = data?.reply ?? '';

      // Save assistant reply
      const { data: savedAssistant, error: amErr } = await supabase
        .from('messages')
        .insert({ conversation_id: convId, user_id: user!.id, role: 'assistant', content: reply })
        .select()
        .single();
      if (amErr) throw amErr;

      setMessages((prev) => [
        ...prev,
        { id: savedAssistant.id, role: 'assistant', content: reply },
      ]);

      // Bump conversation to top
      const now = new Date().toISOString();
      await supabase.from('conversations').update({ updated_at: now }).eq('id', convId);
      setConversations((prev) => {
        const updated = prev.map((c) => (c.id === convId ? { ...c, updated_at: now } : c));
        return [...updated].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      });
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to get a response');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(inputValue);
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-subtle">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  const sidebarSessions = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    date: new Date(c.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    preview: '',
    isActive: c.id === activeConversationId,
  }));

  return (
    <AppShell
      title="AI Assistant"
      showBack
      onBack={() => navigate('/')}
      sidebar={
        <ChatHistorySidebar
          isOpen={historyOpen}
          onToggle={() => setHistoryOpen(!historyOpen)}
          sessions={sidebarSessions}
          loading={conversationsLoading}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          footer={<UserDropdown variant="sidebar" />}
        />
      }
      sidebarOpen={historyOpen}
      onToggleSidebar={() => setHistoryOpen(!historyOpen)}
    >
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full overflow-hidden">
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHistoryOpen(!historyOpen)}
            className="h-7 w-7 flex-shrink-0"
            title={historyOpen ? 'Hide chat history' : 'Show chat history'}
          >
            <History className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 space-y-4">
          {messagesLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            messages.map((message) => (
              <ChatBubble key={message.id} role={message.role}>
                {message.role === 'assistant' ? (
                  <MarkdownMessage content={message.content} />
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                )}
              </ChatBubble>
            ))
          )}
          {isLoading && (
            <ChatBubble role="assistant">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Sparkles className="w-4 h-4 animate-pulse" />
                Thinking…
              </div>
            </ChatBubble>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-border p-3">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question…"
              rows={1}
              className="resize-none min-h-[44px] max-h-40"
              disabled={isLoading}
            />
            <Button
              onClick={() => handleSendMessage(inputValue)}
              disabled={isLoading || !inputValue.trim()}
              size="icon"
              className="h-11 w-11 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-2">
            AI may be inaccurate. Verify important information independently.
          </p>
        </div>
      </div>
    </AppShell>
  );
};

export default ChatView;

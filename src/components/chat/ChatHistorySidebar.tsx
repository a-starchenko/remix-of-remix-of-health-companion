import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MessageSquare, Plus, Clock, ChevronRight, PanelLeftClose, PanelLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatSession {
  id: string;
  title: string;
  date: string;
  preview: string;
  isActive?: boolean;
}

interface ChatHistorySidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  sessions?: ChatSession[];
  loading?: boolean;
  onSelectSession?: (sessionId: string) => void;
  onNewChat?: () => void;
  footer?: React.ReactNode;
}

export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
  isOpen,
  onToggle,
  sessions = [],
  loading = false,
  onSelectSession,
  onNewChat,
  footer,
}) => {
  return (
    <div className={cn(
      "h-full bg-card border-r border-border flex flex-col transition-all duration-300 ease-in-out overflow-hidden",
      isOpen ? "w-72" : "w-0"
    )}>
      {/* Header */}
      <div className={cn(
        "h-14 px-4 flex items-center justify-between border-b border-border flex-shrink-0",
        !isOpen && "hidden"
      )}>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground">Chat History</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onNewChat}
            className="h-8 gap-1.5 px-2 text-xs"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="h-8 w-8"
            title="Close sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Sessions List */}
      <ScrollArea className={cn("flex-1", !isOpen && "hidden")}>
        <div className="p-3 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No conversations yet.</p>
              <p className="text-xs text-muted-foreground">Start chatting to see history here.</p>
            </div>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession?.(session.id)}
                className={cn(
                  "w-full text-left p-3 rounded-xl transition-all duration-150 group",
                  session.isActive
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-accent border border-transparent"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                    session.isActive ? "bg-primary/20" : "bg-muted"
                  )}>
                    <MessageSquare className={cn(
                      "w-4 h-4",
                      session.isActive ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate text-foreground">
                        {session.title}
                      </p>
                      <ChevronRight className={cn(
                        "w-4 h-4 flex-shrink-0 transition-opacity",
                        session.isActive
                          ? "text-primary opacity-100"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100"
                      )} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{session.date}</p>
                    {session.preview && (
                      <p className="text-xs text-muted-foreground truncate mt-1">{session.preview}</p>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer (user menu) */}
      {footer && (
        <div className={cn("border-t border-border p-2 flex-shrink-0", !isOpen && "hidden")}>
          {footer}
        </div>
      )}
    </div>
  );
};

// Toggle button component to show when sidebar is collapsed
export const ChatHistoryToggle: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button
    variant="ghost"
    size="icon"
    onClick={onClick}
    className="h-9 w-9"
    title="Open chat history"
  >
    <PanelLeft className="w-5 h-5" />
  </Button>
);

import React from 'react';
import { Bell, CheckCheck, Trash2, Check, BellOff } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import NotificationRulesPanel from './NotificationRulesPanel';
import type { AlertItem } from '@/hooks/useAlertsCenter';
import type { AlertRules } from '@/lib/alert-rules';

interface Props {
  alerts: AlertItem[];
  unread: number;
  open: boolean;
  setOpen: (o: boolean) => void;
  clear: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  rules: AlertRules;
  suppressed: number;
  clearSuppressed: () => void;
}

const sevColor: Record<AlertItem['severity'], string> = {
  info: 'text-info border-info/30 bg-info/10',
  warning: 'text-warning border-warning/30 bg-warning/10',
  critical: 'text-destructive border-destructive/30 bg-destructive/10',
};

const fmt = (t: number) => {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

const AlertsBell: React.FC<Props> = ({
  alerts, unread, open, setOpen, clear, markRead, markAllRead, rules, suppressed, clearSuppressed,
}) => {
  const muted = rules.muted || rules.muteUntil > Date.now();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 relative focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts, no unread'}
        >
          {muted ? <BellOff className="h-4 w-4 text-muted-foreground" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-mono flex items-center justify-center animate-pulse"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" role="dialog" aria-label="Notification center">
        <Tabs defaultValue="alerts">
          <div className="flex items-center justify-between p-2 border-b border-border gap-1">
            <TabsList className="h-7">
              <TabsTrigger value="alerts" className="text-[11px] h-6">
                Alerts{unread > 0 ? ` · ${unread}` : ''}
              </TabsTrigger>
              <TabsTrigger value="rules" className="text-[11px] h-6">Rules</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-1">
              <Button
                onClick={markAllRead}
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                disabled={unread === 0}
                aria-label="Mark all as read"
              >
                <CheckCheck className="h-3 w-3 mr-1" /> Read all
              </Button>
              <Button
                onClick={clear}
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                disabled={!alerts.length}
                aria-label="Clear all alerts"
              >
                <Trash2 className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>
          </div>

          <TabsContent value="alerts" className="m-0">
            {muted && (
              <p className="px-3 py-1.5 text-[10px] text-warning border-b border-border/40">
                Alerts are muted — new notifications are being suppressed.
              </p>
            )}
            <ScrollArea className="h-72">
              {alerts.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                  <CheckCheck className="h-5 w-5 text-primary" aria-hidden />
                  All quiet. No alerts.
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {alerts.map(a => (
                    <li
                      key={a.id}
                      className={`p-2.5 text-xs relative ${!a.read ? 'bg-primary/[0.03] border-l-2 border-primary' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-0.5 gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-[9px] uppercase font-display tracking-widest ${sevColor[a.severity]}`}>
                            {a.severity}
                          </span>
                          {a.strategy && (
                            <span className="text-[9px] font-mono text-muted-foreground">{a.strategy}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground font-mono">{fmt(a.ts)}</span>
                          {!a.read && (
                            <Button
                              onClick={() => markRead(a.id)}
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5"
                              aria-label={`Mark "${a.title}" as read`}
                              title="Mark as read"
                            >
                              <Check className="h-3 w-3" aria-hidden />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="text-foreground font-display">{a.title}</div>
                      {a.detail && <div className="text-[11px] text-muted-foreground mt-0.5">{a.detail}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="rules" className="m-0">
            <ScrollArea className="h-80">
              <NotificationRulesPanel rules={rules} suppressed={suppressed} clearSuppressed={clearSuppressed} />
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
};

export default AlertsBell;

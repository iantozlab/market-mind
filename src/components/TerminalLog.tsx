import React from 'react';
import type { LogEntry } from '@/lib/neural-bot-engine';

const typeColors: Record<LogEntry['type'], string> = {
  info: 'text-foreground',
  warning: 'text-warning',
  trade: 'text-primary text-glow',
  anomaly: 'text-accent text-glow-accent',
  error: 'text-destructive',
  strategy: 'text-info',
};

interface TerminalLogProps {
  logs: LogEntry[];
}

const TerminalLog: React.FC<TerminalLogProps> = ({ logs }) => (
  <div className="h-80 overflow-y-auto rounded-lg border border-border bg-card p-3 font-mono text-xs terminal-scrollbar scanline">
    {logs.length === 0 ? (
      <p className="text-muted-foreground animate-pulse-glow">Awaiting neural network initialization...</p>
    ) : (
      logs.map((log, i) => (
        <div key={i} className={`py-0.5 leading-relaxed ${typeColors[log.type]}`}>
          <span className="text-muted-foreground">[{log.time}]</span> {log.message}
        </div>
      ))
    )}
  </div>
);

export default TerminalLog;

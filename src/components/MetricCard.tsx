import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  hint?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, trend = 'neutral', hint }) => {
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const tone =
    trend === 'up' ? 'text-primary' :
    trend === 'down' ? 'text-destructive' :
    'text-muted-foreground';
  const glow =
    trend === 'up' ? 'shadow-[0_0_18px_-6px_hsl(var(--primary)/0.55)]' :
    trend === 'down' ? 'shadow-[0_0_18px_-6px_hsl(var(--destructive)/0.55)]' :
    '';
  return (
    <div className={`group relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-card to-card/60 p-3 transition-all hover:border-primary/40 hover:-translate-y-0.5 ${glow}`}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
        <Icon className={`h-3 w-3 ${tone}`} />
      </div>
      <p className={`mt-1 font-display text-xl font-bold tabular-nums ${
        trend === 'up' ? 'text-primary text-glow' : trend === 'down' ? 'text-destructive' : 'text-foreground'
      }`}>
        {value}
      </p>
      {hint && <p className="text-[9px] text-muted-foreground/70 mt-0.5 truncate">{hint}</p>}
    </div>
  );
};

export default MetricCard;

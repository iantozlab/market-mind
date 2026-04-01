import React from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, trend }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
    <p className={`mt-1 font-display text-xl font-bold ${
      trend === 'up' ? 'text-primary text-glow' : trend === 'down' ? 'text-destructive' : 'text-foreground'
    }`}>
      {value}
    </p>
  </div>
);

export default MetricCard;

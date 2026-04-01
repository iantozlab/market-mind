import React from 'react';

interface NeuralStatusCardProps {
  title: string;
  status: string;
  detail: string;
  isActive: boolean;
  color: 'primary' | 'accent' | 'info' | 'warning';
}

const colorMap = {
  primary: 'border-primary/40 bg-primary/5',
  accent: 'border-accent/40 bg-accent/5',
  info: 'border-info/40 bg-info/5',
  warning: 'border-warning/40 bg-warning/5',
};

const statusColorMap = {
  primary: 'text-primary text-glow',
  accent: 'text-accent text-glow-accent',
  info: 'text-info',
  warning: 'text-warning',
};

const NeuralStatusCard: React.FC<NeuralStatusCardProps> = ({ title, status, detail, isActive, color }) => (
  <div className={`rounded-lg border p-4 transition-all duration-300 ${colorMap[color]} ${isActive ? 'glow-primary' : 'opacity-60'}`}>
    <p className="text-xs font-display uppercase tracking-widest text-muted-foreground">{title}</p>
    <p className={`mt-1 text-lg font-bold font-display ${statusColorMap[color]}`}>{status}</p>
    <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
  </div>
);

export default NeuralStatusCard;

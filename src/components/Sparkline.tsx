import React from 'react';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

const Sparkline: React.FC<Props> = ({
  data,
  width = 80,
  height = 22,
  stroke = 'hsl(var(--primary))',
  fill = 'hsl(var(--primary) / 0.15)',
}) => {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="text-[9px] text-muted-foreground">—</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `M0,${height} L${points.join(' L')} L${width},${height} Z`;
  const line = `M${points.join(' L')}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={area} fill={fill} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.25} />
    </svg>
  );
};

export default Sparkline;

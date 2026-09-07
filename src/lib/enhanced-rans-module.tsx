import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { MarketRegime } from './rans-engine';

export enum KillLevel {
  NONE = 'none',
  WARNING = 'warning',
  REDUCED = 'reduced',
  PAUSED = 'paused',
  PERMANENT = 'permanent',
}

export interface KillSwitchState {
  level: KillLevel;
  reason: string;
  triggeredAt: number;
  metrics: {
    winRate30: number;
    dailyPnL: number;
    maxDrawdown: number;
    regime: MarketRegime;
  };
  autoResumeAllowed: boolean;
  autoResumeThresholds: {
    winRate30: number;
    dailyPnL: number;
    maxDrawdown: number;
  };
  resumeRequestedAt: number;
  resumeApproved: boolean;
  resumeRejected: boolean;
}

export interface AutoResumeRequest {
  id: string;
  timestamp: number;
  killLevel: KillLevel;
  killReason: string;
  currentMetrics: {
    winRate30: number;
    dailyPnL: number;
    maxDrawdown: number;
  };
  resumeConditions: {
    winRate30: number;
    dailyPnL: number;
    maxDrawdown: number;
  };
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt: number;
}

export interface RansRegimeFeatures {
  volatility: number;
  momentum: number;
  volumeSpike: number;
  priceRange: number;
}

type EventMap = {
  resume_requested: AutoResumeRequest;
  resume_approved: AutoResumeRequest;
  resume_rejected: AutoResumeRequest;
  resume_snoozed: { request: AutoResumeRequest; minutes: number };
};

class TypedEmitter {
  private listeners: Partial<Record<keyof EventMap, Array<(payload: unknown) => void>>> = {};

  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void) {
    (this.listeners[event] ??= []).push(handler as (payload: unknown) => void);
    return this;
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
    for (const handler of this.listeners[event] ?? []) {
      try {
        handler(payload);
      } catch {
        // noop
      }
    }
  }

  removeAllListeners() {
    this.listeners = {};
  }
}

export class EnhancedRANSExecutionEngine extends TypedEmitter {
  private killState: KillSwitchState;
  private pendingResumeRequest: AutoResumeRequest | null = null;
  private tradeHistory: Array<{ timestamp: number; pnl: number; marketId: string }> = [];
  private capital: number;
  private initialCapital: number;

  constructor(initialCapital: number) {
    super();
    this.initialCapital = initialCapital;
    this.capital = initialCapital;

    this.killState = {
      level: KillLevel.NONE,
      reason: '',
      triggeredAt: 0,
      metrics: {
        winRate30: 0.5,
        dailyPnL: 0,
        maxDrawdown: 0,
        regime: 'low_volatility',
      },
      autoResumeAllowed: true,
      autoResumeThresholds: {
        winRate30: 0.55,
        dailyPnL: -50,
        maxDrawdown: 0.05,
      },
      resumeRequestedAt: 0,
      resumeApproved: false,
      resumeRejected: false,
    };
  }

  private evaluateKillConditions(trades: Array<{ pnl: number; timestamp: number }>): KillLevel {
    if (trades.length < 30) return KillLevel.NONE;
    const recent = trades.slice(-30);
    const winRate = recent.length ? recent.filter((t) => t.pnl > 0).length / recent.length : 0.5;
    const dailyPnL = trades
      .filter((t) => Date.now() - t.timestamp < 86400000)
      .reduce((s, t) => s + t.pnl, 0);
    const maxDrawdown = this.calculateMaxDrawdown(trades);

    if (maxDrawdown > 0.2 || dailyPnL < -1000) return KillLevel.PERMANENT;
    if (winRate < 0.35 || dailyPnL < -300) return KillLevel.PAUSED;
    if (winRate < 0.45 || dailyPnL < -150 || maxDrawdown > 0.1) return KillLevel.REDUCED;
    if (winRate < 0.5 || dailyPnL < -100) return KillLevel.WARNING;
    return KillLevel.NONE;
  }

  public recordTrade(pnl: number, marketId: string): KillLevel {
    if (!Number.isFinite(pnl)) return this.killState.level;

    this.tradeHistory.push({ timestamp: Date.now(), pnl, marketId });
    if (this.tradeHistory.length > 500) this.tradeHistory.shift();
    this.capital += pnl;

    const level = this.evaluateKillConditions(this.tradeHistory);
    if (level !== this.killState.level) {
      this.killState.level = level;
      this.killState.reason = level === KillLevel.NONE ? '' : `Performance guard: ${level}`;
      this.killState.triggeredAt = level === KillLevel.NONE ? 0 : Date.now();
      this.killState.metrics = {
        winRate30: this.tradeHistory.slice(-30).filter((trade) => trade.pnl > 0).length / Math.min(30, this.tradeHistory.length),
        dailyPnL: this.tradeHistory
          .filter((trade) => Date.now() - trade.timestamp < 86400000)
          .reduce((sum, trade) => sum + trade.pnl, 0),
        maxDrawdown: this.calculateMaxDrawdown(this.tradeHistory),
        regime: this.killState.metrics.regime,
      };
    }
    return level;
  }

  private calculateMaxDrawdown(trades: Array<{ pnl: number; timestamp: number }>): number {
    let peak = 0;
    let drawdown = 0;
    let running = 0;
    for (const t of trades) {
      running += t.pnl;
      if (running > peak) peak = running;
      const dd = (peak - running) / (peak + 1);
      if (dd > drawdown) drawdown = dd;
    }
    return drawdown;
  }

  public checkAutoResume(): { canResume: boolean; reason: string } {
    if (this.killState.level === KillLevel.PERMANENT) {
      return { canResume: false, reason: 'Permanent kill – manual review required' };
    }
    if (!this.killState.autoResumeAllowed) {
      return { canResume: false, reason: 'Auto-resume disabled for this kill event' };
    }

    const recent = this.tradeHistory.slice(-30);
    const winRate = recent.length ? recent.filter((t) => t.pnl > 0).length / recent.length : 0.5;
    const dailyPnL = this.tradeHistory
      .filter((t) => Date.now() - t.timestamp < 86400000)
      .reduce((s, t) => s + t.pnl, 0);
    const maxDrawdown = this.calculateMaxDrawdown(this.tradeHistory);

    const ok =
      winRate >= this.killState.autoResumeThresholds.winRate30 &&
      dailyPnL >= this.killState.autoResumeThresholds.dailyPnL &&
      maxDrawdown <= this.killState.autoResumeThresholds.maxDrawdown;

    if (ok) {
      return {
        canResume: true,
        reason: `WR=${(winRate * 100).toFixed(0)}% PnL=$${dailyPnL.toFixed(0)} DD=${(maxDrawdown * 100).toFixed(1)}%`,
      };
    }

    return {
      canResume: false,
      reason: `WR=${(winRate * 100).toFixed(0)}% (need ${(this.killState.autoResumeThresholds.winRate30 * 100).toFixed(0)}%) PnL=$${dailyPnL.toFixed(0)} DD=${(maxDrawdown * 100).toFixed(1)}%`,
    };
  }

  public requestAutoResume(): AutoResumeRequest | null {
    const check = this.checkAutoResume();
    if (!check.canResume) return null;

    const req: AutoResumeRequest = {
      id: `resume_${Date.now()}`,
      timestamp: Date.now(),
      killLevel: this.killState.level,
      killReason: this.killState.reason,
      currentMetrics: {
        winRate30: this.killState.metrics.winRate30,
        dailyPnL: this.killState.metrics.dailyPnL,
        maxDrawdown: this.killState.metrics.maxDrawdown,
      },
      resumeConditions: {
        winRate30: this.killState.autoResumeThresholds.winRate30,
        dailyPnL: this.killState.autoResumeThresholds.dailyPnL,
        maxDrawdown: this.killState.autoResumeThresholds.maxDrawdown,
      },
      status: 'pending',
      expiresAt: Date.now() + 3600000,
    };

    this.pendingResumeRequest = req;
    this.killState.resumeRequestedAt = Date.now();
    this.emit('resume_requested', req);
    return req;
  }

  public approveResume(): boolean {
    if (!this.pendingResumeRequest || this.pendingResumeRequest.status !== 'pending') return false;
    this.pendingResumeRequest.status = 'approved';
    this.killState.resumeApproved = true;
    this.killState.level = KillLevel.NONE;
    this.killState.reason = '';
    this.emit('resume_approved', this.pendingResumeRequest);
    this.pendingResumeRequest = null;
    return true;
  }

  public rejectResume(): boolean {
    if (!this.pendingResumeRequest || this.pendingResumeRequest.status !== 'pending') return false;
    this.pendingResumeRequest.status = 'rejected';
    this.killState.resumeRejected = true;
    this.killState.autoResumeAllowed = false;
    this.emit('resume_rejected', this.pendingResumeRequest);
    this.pendingResumeRequest = null;
    return true;
  }

  public snoozeResume(minutes: number): boolean {
    if (!this.pendingResumeRequest || this.pendingResumeRequest.status !== 'pending') return false;
    this.pendingResumeRequest.expiresAt = Date.now() + minutes * 60000;
    this.emit('resume_snoozed', { request: this.pendingResumeRequest, minutes });
    return true;
  }

  public detectRegime(features: RansRegimeFeatures): { regime: MarketRegime; confidence: number; probabilities: Record<MarketRegime, number> } {
    const { volatility, momentum, volumeSpike, priceRange } = features;

    if (volatility < 0.008 && momentum < 0.3 && volumeSpike < 1.5) {
      return {
        regime: 'low_volatility',
        confidence: 0.75,
        probabilities: {
          trending: 0.05,
          mean_reverting: 0.1,
          high_volatility: 0,
          low_volatility: 0.75,
          event_driven: 0,
        },
      };
    }

    if (priceRange > 0.03 && momentum < 0.2) {
      return {
        regime: 'mean_reverting',
        confidence: 0.7,
        probabilities: {
          trending: 0,
          mean_reverting: 0.1,
          high_volatility: 0.2,
          low_volatility: 0,
          event_driven: 0,
        },
      };
    }

    if (volumeSpike > 3.0) {
      return {
        regime: 'event_driven',
        confidence: 0.85,
        probabilities: {
          trending: 0.05,
          mean_reverting: 0,
          high_volatility: 0.1,
          low_volatility: 0,
          event_driven: 0.85,
        },
      };
    }

    if (volatility > 0.03) {
      return {
        regime: 'high_volatility',
        confidence: 0.8,
        probabilities: {
          trending: 0.05,
          mean_reverting: 0.15,
          high_volatility: 0.8,
          low_volatility: 0,
          event_driven: 0,
        },
      };
    }

    if (volatility < 0.01) {
      return {
        regime: 'low_volatility',
        confidence: 0.7,
        probabilities: {
          trending: 0.1,
          mean_reverting: 0.2,
          high_volatility: 0,
          low_volatility: 0.7,
          event_driven: 0,
        },
      };
    }

    if (momentum > 0.6) {
      return {
        regime: 'trending',
        confidence: 0.75,
        probabilities: {
          trending: 0.75,
          mean_reverting: 0.2,
          high_volatility: 0.05,
          low_volatility: 0,
          event_driven: 0,
        },
      };
    }

    return {
      regime: 'mean_reverting',
      confidence: 0.6,
      probabilities: {
        trending: 0.2,
        mean_reverting: 0.6,
        high_volatility: 0.05,
        low_volatility: 0.15,
        event_driven: 0,
      },
    };
  }

  public getAdjustedPositionSize(baseSize: number): number {
    switch (this.killState.level) {
      case KillLevel.NONE:
        return baseSize;
      case KillLevel.WARNING:
        return baseSize * 0.75;
      case KillLevel.REDUCED:
        return baseSize * 0.5;
      case KillLevel.PAUSED:
      case KillLevel.PERMANENT:
        return 0;
      default:
        return baseSize;
    }
  }

  public getKillLevel(): KillLevel { return this.killState.level; }
  public getKillReason(): string { return this.killState.reason; }
  public getPendingResumeRequest(): AutoResumeRequest | null { return this.pendingResumeRequest; }
  public getCapital(): number { return this.capital; }
  public getTotalRealized(): number { return this.capital - this.initialCapital; }
}

interface AutoResumePopupProps {
  request: AutoResumeRequest;
  onApprove: () => void;
  onReject: () => void;
  onSnooze: (minutes: number) => void;
}

const AutoResumePopup: React.FC<AutoResumePopupProps> = ({ request, onApprove, onReject, onSnooze }) => {
  const timeLeft = Math.max(0, (request.expiresAt - Date.now()) / 60000);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 rounded-lg border border-accent/40 bg-background shadow-xl p-4 animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-3 w-3 rounded-full bg-accent animate-pulse" />
        <span className="text-xs font-display tracking-wide text-accent">RANS AUTO-RESUME REQUEST</span>
      </div>

      <div className="text-sm font-display text-foreground mb-1">
        Kill switch triggered: {request.killReason}
      </div>

      <div className="text-xs text-muted-foreground mb-3">
        Conditions improved — RANS requests permission to resume full trading.
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs font-mono bg-background/40 rounded p-2 mb-3">
        <div>
          <span className="text-muted-foreground">Win Rate</span><br />
          {(request.currentMetrics.winRate30 * 100).toFixed(0)}%{' '}
          <span className="text-muted-foreground">→ need {(request.resumeConditions.winRate30 * 100).toFixed(0)}%</span>
        </div>
        <div>
          <span className="text-muted-foreground">Daily PnL</span><br />
          ${request.currentMetrics.dailyPnL.toFixed(0)}{' '}
          <span className="text-muted-foreground">→ need ${request.resumeConditions.dailyPnL.toFixed(0)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Max DD</span><br />
          {(request.currentMetrics.maxDrawdown * 100).toFixed(1)}%{' '}
          <span className="text-muted-foreground">→ need {(request.resumeConditions.maxDrawdown * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground mb-3">
        Auto-resume expires in {timeLeft.toFixed(0)} minutes
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={onApprove} className="flex-1 bg-accent hover:bg-accent/80 text-accent-foreground">
          Approve Resume
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSnooze(15)} className="flex-1">
          Snooze 15m
        </Button>
        <Button size="sm" variant="destructive" onClick={onReject} className="flex-1">
          Reject
        </Button>
      </div>
    </div>
  );
};

export function useEnhancedRANS(initialCapital: number) {
  const [engine] = useState(() => new EnhancedRANSExecutionEngine(initialCapital));
  const [killLevel, setKillLevel] = useState<KillLevel>(KillLevel.NONE);
  const [pendingRequest, setPendingRequest] = useState<AutoResumeRequest | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    const onResumeRequested = (req: AutoResumeRequest) => {
      setPendingRequest(req);
      setShowPopup(true);
    };
    const onResumeApproved = () => {
      setShowPopup(false);
      setPendingRequest(null);
      toast.success('RANS auto-resume approved – trading resumed');
    };
    const onResumeRejected = () => {
      setShowPopup(false);
      setPendingRequest(null);
      toast.warning('RANS auto-resume rejected – bot remains paused');
    };
    const onResumeSnoozed = ({ minutes }: { minutes: number }) => {
      toast.info(`RANS auto-resume snoozed for ${minutes} minutes`);
    };

    engine.on('resume_requested', onResumeRequested);
    engine.on('resume_approved', onResumeApproved);
    engine.on('resume_rejected', onResumeRejected);
    engine.on('resume_snoozed', onResumeSnoozed);

    const interval = setInterval(() => {
      const level = engine.getKillLevel();
      setKillLevel(level);
      if (level !== KillLevel.NONE && !pendingRequest && engine.checkAutoResume().canResume) {
        engine.requestAutoResume();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      engine.removeAllListeners();
    };
  }, [engine, pendingRequest]);

  const approve = useCallback(() => {
    if (engine.approveResume()) {
      setShowPopup(false);
      setPendingRequest(null);
    }
  }, [engine]);

  const reject = useCallback(() => {
    if (engine.rejectResume()) {
      setShowPopup(false);
      setPendingRequest(null);
    }
  }, [engine]);

  const snooze = useCallback(
    (minutes: number) => {
      if (engine.snoozeResume(minutes)) {
        setShowPopup(false);
        setTimeout(() => {
          const req = engine.getPendingResumeRequest();
          if (req && req.status === 'pending') setShowPopup(true);
        }, minutes * 60000);
      }
    },
    [engine],
  );

  const PopupComponent = useCallback(() => {
    if (!showPopup || !pendingRequest) return null;
    return <AutoResumePopup request={pendingRequest} onApprove={approve} onReject={reject} onSnooze={snooze} />;
  }, [showPopup, pendingRequest, approve, reject, snooze]);

  return {
    engine,
    killLevel,
    pendingRequest,
    Popup: PopupComponent,
    approveResume: approve,
    rejectResume: reject,
    snoozeResume: snooze,
    getAdjustedPositionSize: (base: number) => engine.getAdjustedPositionSize(base),
    detectRegime: (features: RansRegimeFeatures) => engine.detectRegime(features),
    getCapital: () => engine.getCapital(),
    getTotalRealized: () => engine.getTotalRealized(),
  };
}

export default EnhancedRANSExecutionEngine;

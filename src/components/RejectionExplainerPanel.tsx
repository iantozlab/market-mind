import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface Analysis {
  likely_cause: string;
  confidence: string;
  explanation: string;
  safe_next_step: string;
  checks: string[];
  retry_safe: boolean;
}

const RejectionExplainerPanel: React.FC = () => {
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('explain-order-rejection', {
        body: { message, details },
      });
      if (error) {
        let msg = error.message;
        try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      setResult(data.analysis as Analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 font-mono text-sm">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Rejection message</label>
        <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder='e.g. {"error":"not enough balance / allowance"}' />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Order details (optional — never paste keys)</label>
        <Textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="token id, side, price, size, order type, signature type…" />
      </div>
      <Button onClick={run} disabled={loading || !message.trim()}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {loading ? 'Analyzing…' : 'Explain rejection'}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
      {result && (
        <div className="space-y-3 rounded border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-primary">{result.likely_cause}</span>
            <Badge variant="outline">confidence: {result.confidence}</Badge>
            <Badge variant={result.retry_safe ? 'secondary' : 'destructive'}>
              {result.retry_safe ? 'retry OK after fix' : 'do not retry yet'}
            </Badge>
          </div>
          <p className="text-muted-foreground">{result.explanation}</p>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Safe next step</div>
            <p>{result.safe_next_step}</p>
          </div>
          {result.checks?.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {result.checks.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default RejectionExplainerPanel;

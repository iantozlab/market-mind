import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type Mode = "signin" | "signup" | "forgot" | "reset";

const Auth = ({ initialMode = "signin", onResetDone }: { initialMode?: Mode; onResetDone?: () => void }) => {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({
          title: "Account created",
          description: "Check your email to confirm your account, then sign in.",
        });
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        toast({
          title: "Reset link sent",
          description: "Check your email for a link to reset your password.",
        });
        setMode("signin");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast({ title: "Password updated", description: "You can now sign in with your new password." });
        onResetDone?.();
        await supabase.auth.signOut();
      }
    } catch (err) {
      toast({
        title:
          mode === "signin" ? "Sign in failed"
          : mode === "signup" ? "Sign up failed"
          : mode === "forgot" ? "Reset request failed"
          : "Password update failed",
        description: err instanceof Error ? err.message : "Authentication error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<Mode, { heading: string; sub: string; button: string }> = {
    signin: { heading: "Sign In", sub: "Authenticate to access the trading terminal", button: "Sign In" },
    signup: { heading: "Create Account", sub: "Register to access the trading terminal", button: "Create Account" },
    forgot: { heading: "Reset Password", sub: "Enter your email to receive a reset link", button: "Send Reset Link" },
    reset: { heading: "Set New Password", sub: "Choose a new password for your account", button: "Update Password" },
  };
  const t = titles[mode];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-6 text-center">
          <div className="font-mono text-lg font-bold tracking-widest text-primary">
            NEURAL<span className="text-foreground">BOT</span>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{t.sub}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode !== "reset" && (
            <div className="space-y-2">
              <Label htmlFor="email" className="font-mono text-xs">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="font-mono"
              />
            </div>
          )}
          {mode !== "forgot" && (
            <div className="space-y-2">
              <Label htmlFor="password" className="font-mono text-xs">
                {mode === "reset" ? "New Password" : "Password"}
              </Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="font-mono"
              />
            </div>
          )}
          <Button type="submit" className="w-full font-mono" disabled={loading}>
            {loading ? "Working…" : t.button}
          </Button>
        </form>
        <div className="mt-4 space-y-2">
          {mode === "signin" && (
            <>
              <button
                type="button"
                onClick={() => setMode("forgot")}
                className="w-full text-center font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="w-full text-center font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Need an account? Sign up
              </button>
            </>
          )}
          {mode === "signup" && (
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="w-full text-center font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Already have an account? Sign in
            </button>
          )}
          {mode === "forgot" && (
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="w-full text-center font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;

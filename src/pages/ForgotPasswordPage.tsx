import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { MessageCircle, Mail, ArrowLeft } from 'lucide-react';

const ForgotPasswordPage: React.FC = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast({ title: 'Check your email', description: 'A password reset link has been sent.' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to send reset email';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-subtle flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 animate-fade-in">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <MessageCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Reset password</h1>
          <p className="text-muted-foreground">
            {sent
              ? 'Reset link sent — check your inbox'
              : 'Enter your email to receive a reset link'}
          </p>
        </div>

        {!sent && (
          <form onSubmit={handleSubmit} className="bg-card rounded-2xl p-6 shadow-card border border-border space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10"
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Please wait...' : 'Send Reset Link'}
            </Button>
          </form>
        )}

        <div className="text-center">
          <Link
            to="/sign-in"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;

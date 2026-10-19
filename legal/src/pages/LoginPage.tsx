import React, { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/services/api';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The one screen seen before the shell exists, so it carries the brand lockup
 * on its own — the mark over the wordmark, in the sidebar's two-tone.
 *
 * It used to wear things nothing else in the app has: two pulsing blurred
 * gradient blobs, a glow shadow under the button, and bold sentence-case
 * labels. Those were the whole reason it read as a different product from the
 * screen it hands you to. What it has now is the ground, a ruled card and the
 * label band — the same parts as every other form here.
 */
const LoginPage: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // "Forgot password?" swaps the form for one that emails a recovery link.
    const [forgot, setForgot] = useState(false);
    const navigate = useNavigate();
    const { login, error, clearError } = useAuthStore();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            if (forgot) {
                const { detail } = await authApi.forgotPassword(email);
                toast.success(detail || 'If that email has a login, a reset link is on its way.', { duration: 6000 });
                setForgot(false);
                return;
            }
            const success = await login(email, password);
            if (success) {
                navigate('/', { replace: true });
            }
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Could not send the reset link');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4 font-sans">
            <div className="w-full max-w-[26rem]">
                <Card className="p-7 sm:p-9">
                    {/* Brand — stacked, so the wordmark never wraps around the mark */}
                    <div className="flex flex-col items-center text-center">
                        <img src="/logo-mark.png" alt="" className="h-11 w-auto invert dark:invert-0" />
                        <h1 className="mt-5 whitespace-nowrap text-title font-bold tracking-tighter">
                            <span className="text-muted-foreground">Kavas</span>{' '}
                            <span className="text-foreground">Capital-Legal</span>
                        </h1>
                        <p className="mt-2 text-micro font-semibold uppercase tracking-eyebrow text-muted-foreground">
                            Partners' Workspace
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="mt-8 space-y-5 border-t border-border pt-7">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email Address</Label>
                            <div className="relative">
                                <Mail
                                    size={15}
                                    className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
                                />
                                <Input
                                    id="email"
                                    type="email"
                                    autoComplete="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="h-10 pl-9"
                                    placeholder="name@kavas.com"
                                    required
                                />
                            </div>
                        </div>

                        {!forgot && (
                        <div className="space-y-2">
                            <Label htmlFor="password">Account Password</Label>
                            <div className="relative">
                                <Lock
                                    size={15}
                                    className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
                                />
                                <Input
                                    id="password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="h-10 pl-9"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                        </div>
                        )}

                        {!forgot && error && (
                            <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
                                <AlertCircle />
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        <Button type="submit" disabled={submitting} className="mt-2 h-10 w-full">
                            {submitting
                                ? <Loader2 size={15} className="animate-spin" />
                                : <span>{forgot ? 'Send Reset Link' : 'Sign In'}</span>}
                        </Button>

                        <button
                            type="button"
                            onClick={() => { setForgot(!forgot); clearError(); }}
                            className="block w-full text-center text-meta text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {forgot ? 'Back to sign in' : 'Forgot password?'}
                        </button>
                    </form>

                    <p className="mt-7 border-t border-border pt-5 text-center text-meta text-muted-foreground">
                        Kavas Capital partners and team only.
                    </p>
                </Card>
            </div>
        </div>
    );
};

export default LoginPage;

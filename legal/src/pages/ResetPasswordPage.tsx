import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi } from '@/services/api';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Where every password email lands — "Forgot password?", an admin's "Send
 * reset email", and the welcome email (how logins moved over from nightingale
 * set their first password here).
 *
 * The emailed link carries `?token_hash=…&type=recovery`, and the token is
 * spent only when the form is submitted, so a mail scanner that opens the link
 * first can't use it up. A link without one (Supabase's own format) brings its
 * session with it instead, which supabase-js picks up from the URL.
 */
const ResetPasswordPage: React.FC = () => {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tokenHash] = useState(() => {
        const q = new URLSearchParams(window.location.search);
        return q.get('type') === 'recovery' ? q.get('token_hash') : null;
    });
    const [hasSession, setHasSession] = useState<boolean | null>(tokenHash ? true : null);
    const navigate = useNavigate();
    const { checkPlatformSession } = useAuthStore();

    useEffect(() => {
        if (tokenHash) return;
        supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || session) setHasSession(true);
        });
        return () => data.subscription.unsubscribe();
    }, [tokenHash]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (password.length < 8) { setError('Use at least 8 characters.'); return; }
        if (password !== confirm) { setError("The two passwords don't match."); return; }
        setSubmitting(true);
        try {
            await authApi.updatePassword(password, tokenHash);
            toast.success('Password set — you are signed in');
            await checkPlatformSession();
            navigate('/', { replace: true });
        } catch (err: any) {
            setError(err?.response?.data?.detail || 'Could not set the password');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4 font-sans">
            <div className="w-full max-w-[26rem]">
                <Card className="p-7 sm:p-9">
                    <div className="flex flex-col items-center text-center">
                        <img src="/logo-mark.png" alt="" className="h-11 w-auto invert dark:invert-0" />
                        <h1 className="mt-5 whitespace-nowrap text-title font-bold tracking-tighter">
                            Set a new password
                        </h1>
                    </div>

                    {hasSession === false ? (
                        <div className="mt-8 space-y-5 border-t border-border pt-7 text-center">
                            <p className="text-body text-muted-foreground">
                                This link has expired or was already used. Ask for a new one from the sign-in page.
                            </p>
                            <Button onClick={() => navigate('/login', { replace: true })} className="h-10 w-full">
                                Back to sign in
                            </Button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="mt-8 space-y-5 border-t border-border pt-7">
                            {(['password', 'confirm'] as const).map((field) => (
                                <div key={field} className="space-y-2">
                                    <Label htmlFor={field}>{field === 'password' ? 'New Password' : 'Confirm Password'}</Label>
                                    <div className="relative">
                                        <Lock
                                            size={15}
                                            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
                                        />
                                        <Input
                                            id={field}
                                            type="password"
                                            autoComplete="new-password"
                                            value={field === 'password' ? password : confirm}
                                            onChange={(e) => (field === 'password' ? setPassword : setConfirm)(e.target.value)}
                                            className="h-10 pl-9"
                                            placeholder="••••••••"
                                            required
                                        />
                                    </div>
                                </div>
                            ))}

                            {error && (
                                <Alert variant="destructive">
                                    <AlertCircle />
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}

                            <Button type="submit" disabled={submitting || hasSession === null} className="mt-2 h-10 w-full">
                                {submitting ? <Loader2 size={15} className="animate-spin" /> : <span>Set Password</span>}
                            </Button>
                        </form>
                    )}
                </Card>
            </div>
        </div>
    );
};

export default ResetPasswordPage;

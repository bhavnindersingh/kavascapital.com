import React, { useState, useEffect } from 'react';
import { usersApi } from '@/services/api';
import { PlatformUser } from '@/types';
import { UserPlus, Trash2, Mail, User, Loader2, KeyRound, RotateCcw, Copy, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

const ROLE_LABELS: Record<string, string> = {
    viewer: 'Viewer (No Task Board)',
    manager: 'Manager (Works the Task Board)',
    trader: 'Trader (Works the Task Board)',
    super_admin: 'Super Admin (Full Access)',
};

const UserManagementPage: React.FC = () => {
    const [users, setUsers] = useState<PlatformUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAddingUser, setIsAddingUser] = useState(false);
    const { user: me } = useAuthStore();
    // Reset links are emailed. One shows here only when the email could not be
    // sent, for the admin to pass on by hand; it stays until dismissed.
    const [resetLink, setResetLink] = useState<{ name: string; link: string } | null>(null);

    // Form State
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        full_name: '',
        role: 'trader' as const
    });

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const data = await usersApi.listUsers();
            setUsers(data);
        } catch (error) {
            toast.error('Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const created = await usersApi.createUser({
                ...formData,
                password: formData.password || undefined,
            });
            if (created.emailed) {
                toast.success(`Login created — welcome email sent to ${created.email}`, { duration: 6000 });
            } else {
                toast.error('Login created, but the welcome email failed. Use "Send reset email" on their row.', { duration: 8000 });
            }
            setIsAddingUser(false);
            setFormData({ email: '', password: '', full_name: '', role: 'trader' });
            fetchUsers();
        } catch (error: any) {
            // FastAPI validation errors (422) return detail as an array
            const detail = error.response?.data?.detail;
            const msg = Array.isArray(detail)
                ? detail.map((d: any) => d.msg || String(d)).join('; ')
                : detail;
            toast.error(msg || 'Failed to create user');
        }
    };

    const handleDeactivate = async (userId: number) => {
        if (!window.confirm('Are you sure you want to deactivate this user?')) return;
        try {
            await usersApi.deactivateUser(userId);
            toast.success('User account deactivated');
            fetchUsers();
        } catch (error) {
            toast.error(errorText(error, 'Failed to deactivate user'));
        }
    };

    const errorText = (error: any, fallback: string) => {
        const detail = error?.response?.data?.detail;
        return typeof detail === 'string' ? detail : fallback;
    };

    const handleRoleChange = async (userId: number, role: string) => {
        try {
            await usersApi.updateUser(userId, { role });
            toast.success('Role updated');
            fetchUsers();
        } catch (error) {
            toast.error(errorText(error, 'Failed to change role'));
        }
    };

    const handleReactivate = async (userId: number) => {
        try {
            await usersApi.updateUser(userId, { is_active: true });
            toast.success('User account reactivated');
            fetchUsers();
        } catch (error) {
            toast.error(errorText(error, 'Failed to reactivate user'));
        }
    };

    const handleResetLink = async (target: PlatformUser) => {
        try {
            const res = await usersApi.sendPasswordReset(target.id);
            if (res.emailed) {
                toast.success(`Reset email sent to ${res.email}`);
            } else if (res.link) {
                setResetLink({ name: target.full_name, link: res.link });
                toast.error("The email couldn't be sent — copy the link below and pass it on.", { duration: 8000 });
            }
        } catch (error) {
            toast.error(errorText(error, 'Failed to send a reset email'));
        }
    };

    const copyResetLink = async () => {
        if (!resetLink) return;
        try {
            await navigator.clipboard.writeText(resetLink.link);
            toast.success('Link copied');
        } catch {
            toast.error('Copy failed — select the link and copy it by hand');
        }
    };

    if (loading && users.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="max-w-6xl space-y-4 sm:space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-8">
                <div>
                    <h1 className="text-display font-medium leading-tight text-foreground mb-2">Team Management</h1>
                    <p className="text-muted-foreground font-medium">Manage platform users and access levels</p>
                </div>
                <Button
                    onClick={() => setIsAddingUser(!isAddingUser)}
                    className="rounded-xl px-4 py-2.5 font-bold shadow-lg shadow-primary-600/20 transition-all active:scale-95 self-start md:self-auto"
                >
                    <UserPlus size={18} />
                    <span>Add Team Member</span>
                </Button>
            </div>

            {resetLink && (
                <Card className="bg-background border-dark-800 rounded-3xl p-6 mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                            <div className="font-bold tracking-tight">Password reset link for {resetLink.name}</div>
                            <p className="text-meta text-muted-foreground">
                                The email didn't go out — send this to them yourself. It works once and expires in an hour.
                            </p>
                            <Input readOnly value={resetLink.link} onFocus={(e) => e.target.select()}
                                className="h-auto bg-card/50 border-dark-700/50 rounded-xl py-3 px-4 font-mono text-meta" />
                        </div>
                        <div className="flex shrink-0 gap-2 pt-1">
                            <Button onClick={copyResetLink} className="rounded-xl px-4 font-bold">
                                <Copy size={16} />
                                <span>Copy</span>
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setResetLink(null)}
                                className="text-muted-foreground hover:text-foreground" title="Dismiss">
                                <X size={18} />
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {isAddingUser && (
                <Card className="bg-background border-dark-800 rounded-3xl p-8 mb-8 animate-in fade-in slide-in-from-top-4 duration-300">
                    <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="full_name" className="ml-1">Full Name</Label>
                            <Input
                                id="full_name"
                                type="text"
                                required
                                value={formData.full_name}
                                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                className="h-auto bg-card/50 border-dark-700/50 rounded-xl py-3 px-4"
                                placeholder="John Doe"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email" className="ml-1">Email Address</Label>
                            <Input
                                id="email"
                                type="email"
                                required
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="h-auto bg-card/50 border-dark-700/50 rounded-xl py-3 px-4"
                                placeholder="john@kavas.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password" className="ml-1">Password <span className="font-normal text-muted-foreground">(optional)</span></Label>
                            <Input
                                id="password"
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="h-auto bg-card/50 border-dark-700/50 rounded-xl py-3 px-4"
                                placeholder="Blank = they set it from the welcome email"
                                minLength={8}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="ml-1">Platform Role</Label>
                            <Select
                                value={formData.role}
                                onValueChange={(value) => setFormData({ ...formData, role: value as any })}
                            >
                                <SelectTrigger className="h-auto bg-card/50 border-dark-700/50 rounded-xl py-3 px-4">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="md:col-span-2 flex justify-end gap-3 pt-4">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setIsAddingUser(false)}
                                className="text-muted-foreground hover:text-foreground px-6 font-medium"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                className="rounded-xl px-8 font-bold shadow-lg shadow-primary-600/10"
                            >
                                Create User
                            </Button>
                        </div>
                    </form>
                </Card>
            )}

            <Card className="bg-background border-dark-800 rounded-3xl overflow-hidden shadow-xl">
                <Table className="border-collapse min-w-[560px]">
                    <TableHeader>
                        <TableRow className="border-border bg-card hover:bg-card">
                            <TableHead className="h-auto py-4 px-6">User Details</TableHead>
                            <TableHead className="h-auto py-4 px-6">Access Role</TableHead>
                            <TableHead className="h-auto py-4 px-6">Status</TableHead>
                            <TableHead className="h-auto py-4 px-6 text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-dark-800/50">
                        {users.map((user) => (
                            <TableRow key={user.id} className="border-0 hover:bg-dark-800/20 group">
                                <TableCell className="py-5 px-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-dark-800 to-dark-900 border border-dark-700 flex items-center justify-center text-muted-foreground group-hover:text-foreground group-hover:border-primary-500/30 transition-all">
                                            <User size={20} />
                                        </div>
                                        <div>
                                            <div className="font-bold tracking-tight">{user.full_name}</div>
                                            <div className="text-muted-foreground text-body flex items-center gap-1.5 font-medium">
                                                <Mail size={12} className="text-muted-foreground" />
                                                {user.email}
                                            </div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="py-5 px-6">
                                    {/* Your own role is fixed here, so an admin can't lock themselves out. */}
                                    <Select
                                        value={user.role}
                                        disabled={user.id === me?.id}
                                        onValueChange={(value) => handleRoleChange(user.id, value)}
                                    >
                                        <SelectTrigger className={`h-auto w-auto gap-2 px-2.5 py-1 rounded-lg border text-micro font-semibold tracking-widest uppercase ${user.role === 'super_admin' ? 'bg-warning-500/5 border-warning-500/10 text-warning-500' : user.role === 'trader' ? 'bg-primary-500/5 border-primary-500/10 text-foreground' : user.role === 'manager' ? 'bg-accent border-border text-foreground' : 'bg-dark-500/5 border-dark-500/10 text-muted-foreground' }`}>
                                            <SelectValue>{user.role}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(ROLE_LABELS).map(([value, label]) => (
                                                <SelectItem key={value} value={value}>{label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TableCell>
                                <TableCell className="py-5 px-6">
                                    {user.is_active ? (
                                        <div className="flex items-center gap-1.5 text-success-500 text-micro font-semibold tracking-widest">
                                            <div className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse" />
                                            ACTIVE
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 text-muted-foreground text-micro font-semibold tracking-widest">
                                            <div className="w-1.5 h-1.5 rounded-full bg-dark-600" />
                                            DEACTIVATED
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell className="py-5 px-6 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                    {user.is_active && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleResetLink(user)}
                                            className="h-auto w-auto text-muted-foreground hover:text-foreground p-2.5 rounded-xl hover:bg-accent opacity-0 group-hover:opacity-100 transition-all"
                                            title="Send reset email"
                                        >
                                            <KeyRound size={18} />
                                        </Button>
                                    )}
                                    {!user.is_active && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleReactivate(user.id)}
                                            className="h-auto w-auto text-muted-foreground hover:text-success-500 p-2.5 rounded-xl hover:bg-success-500/10 opacity-0 group-hover:opacity-100 transition-all"
                                            title="Reactivate Account"
                                        >
                                            <RotateCcw size={18} />
                                        </Button>
                                    )}
                                    {user.is_active && user.id !== me?.id && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDeactivate(user.id)}
                                            className="h-auto w-auto text-muted-foreground hover:text-danger-500 p-2.5 rounded-xl hover:bg-danger-500/10 opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0"
                                            title="Deactivate Account"
                                        >
                                            <Trash2 size={18} />
                                        </Button>
                                    )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {users.length === 0 && (
                    <div className="py-20 text-center">
                        <User size={48} className="mx-auto text-dark-800 mb-4" />
                        <p className="text-muted-foreground font-medium">No team members found.</p>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default UserManagementPage;

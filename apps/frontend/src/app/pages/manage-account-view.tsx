import { useState, useEffect } from 'react';
import { useAppContext } from '../context/app-context';
import { api } from '../../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { toast } from 'sonner';

export function ManageAccountView() {
  const { user, setUser } = useAppContext();

  const [firstName, setFirstName]   = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName]     = useState('');
  const [mobile, setMobile]         = useState('');
  const [email, setEmail]           = useState('');
  const [loading, setLoading]       = useState(false);

  // Seed form from context (already fetched on app boot via getMe)
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName   ?? '');
    setMiddleName(user.middleName ?? '');
    setLastName(user.lastName     ?? '');
    setMobile(user.mobile         ?? '');
    setEmail(user.email           ?? '');
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const updated = await api.updateMe({
        first_name:  firstName,
        middle_name: middleName || null,
        last_name:   lastName,
        mobile:      mobile     || null,
        email:       email      || null,
      }) as any;

      // Sync context with what the server returned
      setUser({
        ...user,
        firstName:  updated.first_name,
        middleName: updated.middle_name,
        lastName:   updated.last_name,
        mobile:     updated.mobile,
        email:      updated.email,
      });

      toast.success('Account updated successfully!');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to update account');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="mb-2">Manage Account</h1>
        <p className="text-muted-foreground">Update your personal information</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>
            Your unique PID: <span className="font-mono">{user.pid}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="middleName">Middle Name</Label>
              <Input
                id="middleName"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
                placeholder="Middle name (optional)"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mobile">Mobile Number (10 digits)</Label>
            <Input
              id="mobile"
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="9876543210"
              maxLength={10}
            />
          </div>

          <div className="pt-4">
            <Button onClick={handleSave} disabled={loading}>
              {loading ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
          <CardDescription>Read-only account details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">State</Label>
              <p className="mt-1">{user.state || 'Not set'}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Country</Label>
              <p className="mt-1">{user.country || 'Not set'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
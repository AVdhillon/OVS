import { useState, useEffect } from 'react';
import { useAppContext } from '../context/app-context';
import { api } from '../../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { countryStateMap } from '../../constants/location';
import { UpdateMeResponse } from '../../types/users';

export function ManageAccountView() {
  const { user, setUser } = useAppContext();

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [mobileOtp, setMobileOtp] = useState('');
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');
  const [emailChanged, setEmailChanged] = useState(false);
  const [mobileChanged, setMobileChanged] = useState(false);

  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [sendingMobileOtp, setSendingMobileOtp] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  // Seed form from context (already fetched on app boot via getMe)
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setMiddleName(user.middleName ?? '');
    setLastName(user.lastName ?? '');
    setMobile(user.mobile ?? '');
    setEmail(user.email ?? '');
    setCountry(user.country ?? '');
    setState(user.state ?? '');
  }, [user]);
  const sendEmailOtp = async () => {
    setSendingEmailOtp(true);
    try {
      await api.sendOtp(email);
      toast.success('OTP sent to email');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const sendMobileOtp = async () => {
    setSendingMobileOtp(true);
    try {
      await api.sendOtp(mobile);
      toast.success('OTP sent to mobile');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSendingMobileOtp(false);
    }
  };
  const handleSave = async () => {
    if (!user) return;

    const payload: any = {};

    if (firstName !== user.firstName) payload.first_name = firstName;
    if (middleName !== (user.middleName ?? '')) payload.middle_name = middleName || null;
    if (lastName !== user.lastName) payload.last_name = lastName;
    if (state !== (user.state ?? '')) payload.state = state;
    if (country !== (user.country ?? '')) payload.country = country;
    if (email !== (user.email ?? '')) {
      payload.email = email || null;
      payload.email_otp = emailOtp; // include OTP
    }

    if (mobile !== (user.mobile ?? '')) {
      payload.mobile = mobile || null;
      payload.mobile_otp = mobileOtp; // include OTP
    }

    if (Object.keys(payload).length === 0) {
      toast.info('No changes to update');
      return;
    }

    setLoading(true);
    try {
      const updated = await api.updateMe(payload);

      setUser({
        ...user,
        ...{
          firstName: updated.first_name,
          middleName: updated.middle_name,
          lastName: updated.last_name,
          mobile: updated.mobile,
          email: updated.email,
          state: updated.state,
          country: updated.country,
        }
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
                disabled={!isEditing}
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="middleName">Middle Name</Label>
              <Input
                disabled={!isEditing}
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
              disabled={!isEditing}
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* STATE */}
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>

              <Select
                value={state}
                onValueChange={setState}
                disabled={!isEditing || !country}
              >
                <SelectTrigger id="state">
                  <SelectValue
                    placeholder={country ? "Select state" : "Select country first"}
                  />
                </SelectTrigger>

                <SelectContent>
                  {countryStateMap[country]?.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* COUNTRY */}
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>

              <Select
                value={country}
                onValueChange={(val) => {
                  setCountry(val);
                  setState('');
                }}
                disabled={!isEditing}
              >
                <SelectTrigger id="country">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="USA">United States</SelectItem>
                  <SelectItem value="UK">United Kingdom</SelectItem>
                  <SelectItem value="CA">Canada</SelectItem>
                  <SelectItem value="AU">Australia</SelectItem>
                  <SelectItem value="IN">India</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="flex gap-2">
              <Input
                disabled={!isEditing}
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailChanged(e.target.value !== (user?.email ?? ''));
                }}
                placeholder="your@email.com"
              />
              {isEditing && emailChanged && (
                <Button onClick={sendEmailOtp} disabled={!isEditing || sendingEmailOtp}>
                  {sendingEmailOtp ? 'Sending...' : 'Get OTP'}
                </Button>
              )}
            </div>

            {isEditing && emailChanged && (
              <Input
                placeholder="Enter Email OTP"
                value={emailOtp}
                onChange={(e) => setEmailOtp(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mobile">Mobile Number (10 digits)</Label>
            <div className="flex gap-2">
              <Input
                disabled={!isEditing}
                id="mobile"
                type="tel"
                value={mobile}
                onChange={(e) => {
                  setMobile(e.target.value);
                  setMobileChanged(e.target.value !== (user?.mobile ?? ''));
                }}
                placeholder="9876543210"
                maxLength={10}
              />
              {isEditing && mobileChanged && (
                <Button onClick={sendMobileOtp} disabled={!isEditing || sendingMobileOtp}>
                  {sendingMobileOtp ? 'Sending...' : 'Get OTP'}
                </Button>
              )}
            </div>

            {isEditing && mobileChanged && (
              <Input
                placeholder="Enter Mobile OTP"
                value={mobileOtp}
                onChange={(e) => setMobileOtp(e.target.value)}
              />
            )}
          </div>

          <div className="pt-4 flex gap-2">
            {!isEditing ? (
              <Button onClick={() => setIsEditing(true)}>
                Edit
              </Button>
            ) : (
              <>
                <Button onClick={handleSave} disabled={loading}>
                  {loading ? 'Saving…' : 'Save Changes'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    // reset values from user
                    setFirstName(user.firstName ?? '');
                    setMiddleName(user.middleName ?? '');
                    setLastName(user.lastName ?? '');
                    setMobile(user.mobile ?? '');
                    setEmail(user.email ?? '');
                    setCountry(user.country ?? '');
                    setState(user.state ?? '');
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>


    </div>
  );
}
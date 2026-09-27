export function serializeBigInt(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}
export function splitIdentifier(value: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^[0-9]{10}$/; // exactly 10 digits — matches uaccount.mobile's CHECK constraint and every mobile validator in the app (register.dto.ts, update-user.dto.ts, invite-admin.dto.ts)

  if (emailRegex.test(value)) {
    return { email: value, mobile: null };
  }

  if (phoneRegex.test(value)) {
    return { email: null, mobile: value };
  }

  throw new Error('Invalid identifier');
}

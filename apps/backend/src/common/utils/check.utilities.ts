export function serializeBigInt(obj: any) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}
export function splitIdentifier(value: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^[1-9]\d{9}$/; // exactly 10 digits, no leading zero — matches org_members.mobile CHECK constraint

  if (emailRegex.test(value)) {
    return { email: value, mobile: null };
  }

  if (phoneRegex.test(value)) {
    return { email: null, mobile: value };
  }

  throw new Error('Invalid identifier');
}

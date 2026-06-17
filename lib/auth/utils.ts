export function getVirtualEmailForDriver(driverId: string): string {
  return `driver-${driverId}@internal.yango`;
}

export function extractDriverIdFromVirtualEmail(email: string): string | null {
  const match = email.match(/^driver-(.+)@internal\.yango$/);
  return match ? match[1] : null;
}

export function isVirtualEmail(email: string): boolean {
  return email.endsWith("@internal.yango");
}

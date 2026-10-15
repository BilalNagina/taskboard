// IPv4 CIDR matching for the payment provider's webhook allowlist ("34.232.58.13/32").
// Addresses may arrive IPv4-mapped ("::ffff:34.232.58.13"); anything else that isn't
// IPv4 never matches.
const toInt = (ip) => {
  const parts = ip.replace(/^::ffff:/i, '').split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n;
};

export function inCidr(ip, cidr) {
  const [base, bitsText = '32'] = cidr.split('/');
  const bits = Number(bitsText);
  const address = toInt(ip ?? '');
  const network = toInt(base);
  if (address === null || network === null || !(bits >= 0 && bits <= 32)) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(address / size) === Math.floor(network / size);
}

export const inAnyCidr = (ip, cidrs) => cidrs.some((cidr) => inCidr(ip, cidr));

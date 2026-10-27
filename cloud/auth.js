import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
const resolvers = new Map();
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export async function identity(request, env) {
  const issuer = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!issuer || !env.ACCESS_AUD) throw new HttpError(503, 'Configure Cloudflare Access before opening CourtIQ.');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) throw new HttpError(503, 'Invalid Access team domain.');
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
  if (!token) throw new HttpError(401, '请先登录。');
  try {
    if (!resolvers.has(issuer)) resolvers.set(issuer, createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs')));
    const {payload} = await jwtVerify(token, resolvers.get(issuer), {issuer, audience:env.ACCESS_AUD, algorithms:['RS256'], requiredClaims:['sub','exp','iat']});
    if (!payload.sub || !payload.email || typeof payload.email !== 'string') throw new Error('User identity required');
    return {id:payload.sub, email:payload.email};
  } catch { throw new HttpError(401, '登录已过期，请重新登录。'); }
}
function cookie(request, key) {
  return (request.headers.get('cookie') || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(key+'='))?.slice(key.length+1);
}
function secret(env) {
  if (!env.INTERNAL_SECRET || env.INTERNAL_SECRET.length < 32) throw new HttpError(503, 'Set INTERNAL_SECRET (at least 32 characters).');
  return new TextEncoder().encode(env.INTERNAL_SECRET);
}
export async function capability(env, claims, ttl=7200) {
  return new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setIssuer('courtiq').setAudience('storage')
    .setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+ttl).sign(secret(env));
}
export async function storageIdentity(request, env) {
  try {
    const value=request.headers.get('authorization') || '';
    const {payload}=await jwtVerify(value.replace(/^Bearer /,''),secret(env),{issuer:'courtiq',audience:'storage',algorithms:['HS256'],requiredClaims:['exp']});
    return payload;
  } catch { throw new HttpError(401,'Invalid storage capability.'); }
}

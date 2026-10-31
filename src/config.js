import dotenv from 'dotenv';

dotenv.config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

export const config = {
  port: Number(env.PORT) || 3001,
  mongoUri: env.MONGODB_URI || '',
  adminUsername: env.ADMIN_USERNAME || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  jwtSecret: env.JWT_SECRET || '',
  clientOrigins: (env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  trustProxy: env.TRUST_PROXY === 'true',
  // Two different domains (e.g. vercel.app + onrender.com) need SameSite=None over HTTPS.
  sameSite: env.COOKIE_SAMESITE || (isProd && env.CLIENT_ORIGIN ? 'none' : 'strict'),
  sessionMs: 12 * 60 * 60 * 1000, // stay logged in for 12 hours
  maxAttempts: 5, // wrong attempts before the lock
  lockMs: 15 * 60 * 1000, // lock for 15 minutes
  maxImageBytes: 4 * 1024 * 1024,
};

export function configProblem(c = config) {
  if (!c.mongoUri) return 'Missing setting: MONGODB_URI (your MongoDB connection string).';
  if (!c.adminUsername || !c.adminPassword) return 'Missing settings: ADMIN_USERNAME and ADMIN_PASSWORD.';
  if (c.jwtSecret.length < 32) return 'JWT_SECRET must be a random string of at least 32 characters.';
  return '';
}

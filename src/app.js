import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import multer from 'multer';
import { config, configProblem } from './config.js';
import { connect } from './db.js';
import { Image } from './models/Image.js';
import { LoginAttempt } from './models/LoginAttempt.js';
import { Profile } from './models/Profile.js';
import { Project } from './models/Project.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Express 4 does not catch errors from async handlers, so wrap them.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp(cfg = config) {
  const app = express();
  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // This server only returns JSON and images, so helmet's defaults are enough.
  app.use(helmet({ hsts: cfg.trustProxy }));

  // The frontend lives on another address, so allow exactly that address (with cookies).
  const allowed = cfg.clientOrigins;
  if (allowed.length) {
    app.use(
      cors({
        origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'X-Requested-With'],
      })
    );
  }

  // ---------- health check (no database needed) ----------
  app.get('/api/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

  // ---------- every other /api request: settings check, database ready ----------
  app.use(
    '/api',
    ah(async (req, res, next) => {
      const problem = configProblem(cfg);
      if (problem) {
        console.error(problem);
        return res.status(500).json({ error: 'The server is not set up yet. Check its settings.' });
      }
      await connect();
      next();
    })
  );

  // Photos are public and never change (every upload gets a new random name).
  app.get(
    '/api/img/:name',
    ah(async (req, res) => {
      const img = await Image.findOne({ name: req.params.name }).lean();
      if (!img) return res.status(404).end();
      res.set({
        'Content-Type': img.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'cross-origin', // the frontend is on another address
      });
      res.send(Buffer.from(img.data.buffer ?? img.data));
    })
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Changing data from another website must not work, even though the cookie would be sent.
  // Browsers cannot add this header cross-site without CORS approval, and the origin is checked too.
  app.use('/api/admin', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    const badOrigin = origin && allowed.length && !allowed.includes(origin);
    if (badOrigin || req.get('x-requested-with') !== 'portfolio') {
      return res.status(403).json({ error: 'Request blocked.' });
    }
    next();
  });

  // ---------- helpers ----------
  const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
  const sameText = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

  function str(value, max, label) {
    const s = String(value ?? '').trim();
    if (s.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
    return s;
  }

  function link(value, label) {
    const s = str(value, 300, label);
    if (!s) return '';
    let u;
    try {
      u = new URL(s);
    } catch {
      throw new HttpError(400, `${label} must be a full link that starts with https://`);
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new HttpError(400, `${label} must be a full link that starts with https://`);
    }
    return s;
  }

  function parseTags(value) {
    const seen = new Set();
    const tags = [];
    for (const raw of String(value ?? '').split(',')) {
      const tag = raw.trim();
      if (!tag || seen.has(tag.toLowerCase())) continue;
      if (tag.length > 30) throw new HttpError(400, 'Each tag must be 30 characters or fewer.');
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
    if (tags.length > 8) throw new HttpError(400, 'Use 8 tags or fewer.');
    return tags;
  }

  // Check the real file type from its first bytes, not the name the browser sends.
  function sniffImage(buf) {
    if (buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
    return null;
  }
  const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

  async function saveImage(file) {
    const ext = sniffImage(file.buffer);
    if (!ext) throw new HttpError(400, 'Use a JPG, PNG, WebP or GIF image.');
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    await Image.create({ name, mime: MIME[ext], data: file.buffer });
    return name;
  }
  const removeImage = (name) => (name ? Image.deleteOne({ name }) : null);

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxImageBytes, files: 1 } });

  const imageUrl = (name) => (name ? `/api/img/${name}` : '');
  const projectOut = (p) => ({
    id: String(p._id),
    title: p.title,
    description: p.description,
    link: p.link,
    tags: p.tags,
    image: imageUrl(p.image),
    createdAt: new Date(p.createdAt).toISOString(),
  });
  const profileOut = (p) => ({
    name: p.name,
    title: p.title,
    bio: p.bio,
    email: p.email,
    github: p.github,
    linkedin: p.linkedin,
    photo: imageUrl(p.photo),
  });

  async function getData() {
    const profile = await Profile.findOne({ key: 'main' }).lean();
    const projects = await Project.find().sort({ createdAt: -1, _id: -1 }).lean();
    return { profile: profileOut(profile), projects: projects.map(projectOut) };
  }

  // ---------- login ----------
  const cookieOptions = (req) => ({
    httpOnly: true,
    sameSite: cfg.sameSite,
    secure: req.secure || cfg.sameSite === 'none',
    path: '/',
  });

  function requireAuth(req, res, next) {
    try {
      jwt.verify(req.cookies.session || '', cfg.jwtSecret);
      next();
    } catch {
      res.status(401).json({ error: 'Your session ended. Log in again.' });
    }
  }

  app.post(
    '/api/admin/login',
    ah(async (req, res) => {
      const ip = req.ip || 'unknown';
      const now = Date.now();
      const found = await LoginAttempt.findOne({ ip }).lean();
      let count = found?.count || 0;
      const lockedUntil = found?.lockedUntil || 0;

      if (lockedUntil > now) {
        const minutes = Math.ceil((lockedUntil - now) / 60000);
        return res.status(429).json({ error: `Too many wrong attempts. Try again in ${minutes} minutes.` });
      }
      if (lockedUntil) count = 0; // the lock ran out

      const { username = '', password = '' } = req.body || {};
      const userOk = sameText(username, cfg.adminUsername);
      const passOk = sameText(password, cfg.adminPassword);

      if (userOk && passOk) {
        await LoginAttempt.deleteOne({ ip });
        const token = jwt.sign({ admin: true }, cfg.jwtSecret, { expiresIn: cfg.sessionMs / 1000 });
        res.cookie('session', token, { ...cookieOptions(req), maxAge: cfg.sessionMs });
        return res.json({ ok: true });
      }

      count += 1;
      const locked = count >= cfg.maxAttempts;
      await LoginAttempt.updateOne(
        { ip },
        { $set: { count, lockedUntil: locked ? now + cfg.lockMs : 0, updatedAt: new Date() } },
        { upsert: true }
      );
      if (locked) return res.status(429).json({ error: 'Too many wrong attempts. Login is locked for 15 minutes.' });
      res.status(401).json({ error: 'Wrong username or password.' });
    })
  );

  app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('session', cookieOptions(req));
    res.json({ ok: true });
  });

  app.get('/api/admin/me', requireAuth, (req, res) => res.json({ ok: true }));

  // ---------- public data ----------
  app.get('/api/public', ah(async (req, res) => res.json(await getData())));

  // ---------- admin data ----------
  app.get('/api/admin/data', requireAuth, ah(async (req, res) => res.json(await getData())));

  app.put(
    '/api/admin/profile',
    requireAuth,
    upload.single('photo'),
    ah(async (req, res) => {
      const body = req.body || {};
      const name = str(body.name, 80, 'Name');
      if (!name) throw new HttpError(400, 'Add your name.');
      const email = str(body.email, 120, 'Email');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new HttpError(400, 'Enter an email like you@example.com.');
      }
      const fields = {
        name,
        title: str(body.title, 80, 'Title'),
        bio: str(body.bio, 800, 'Bio'),
        email,
        github: link(body.github, 'GitHub link'),
        linkedin: link(body.linkedin, 'LinkedIn link'),
      };
      const old = await Profile.findOne({ key: 'main' }).lean();
      if (req.file) fields.photo = await saveImage(req.file);
      const updated = await Profile.findOneAndUpdate({ key: 'main' }, { $set: fields }, { new: true, upsert: true }).lean();
      if (req.file) await removeImage(old?.photo);
      res.json(profileOut(updated));
    })
  );

  function readProject(body = {}) {
    const title = str(body.title, 120, 'Title');
    if (!title) throw new HttpError(400, 'Add a title for the project.');
    return {
      title,
      description: str(body.description, 600, 'Description'),
      link: link(body.link, 'Link'),
      tags: parseTags(body.tags),
    };
  }

  const projectId = (req) => {
    if (!mongoose.isValidObjectId(req.params.id) || String(req.params.id).length !== 24) {
      throw new HttpError(404, 'That project no longer exists.');
    }
    return req.params.id;
  };

  app.post(
    '/api/admin/projects',
    requireAuth,
    upload.single('image'),
    ah(async (req, res) => {
      const data = readProject(req.body);
      const image = req.file ? await saveImage(req.file) : '';
      const project = await Project.create({ ...data, image });
      res.status(201).json(projectOut(project));
    })
  );

  app.put(
    '/api/admin/projects/:id',
    requireAuth,
    upload.single('image'),
    ah(async (req, res) => {
      const id = projectId(req);
      const old = await Project.findById(id).lean();
      if (!old) throw new HttpError(404, 'That project no longer exists.');
      const data = readProject(req.body);
      const image = req.file ? await saveImage(req.file) : old.image;
      const project = await Project.findByIdAndUpdate(id, { $set: { ...data, image } }, { new: true }).lean();
      if (req.file) await removeImage(old.image);
      res.json(projectOut(project));
    })
  );

  app.delete(
    '/api/admin/projects/:id',
    requireAuth,
    ah(async (req, res) => {
      const id = projectId(req);
      const old = await Project.findByIdAndDelete(id).lean();
      if (!old) throw new HttpError(404, 'That project no longer exists.');
      await removeImage(old.image);
      res.json({ ok: true });
    })
  );

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---------- errors ----------
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'That image is larger than 4 MB.' : 'The upload did not work. Try another image.';
      return res.status(400).json({ error: message });
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request was not valid.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
  });

  return app;
}

export default createApp();

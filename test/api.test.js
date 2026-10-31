// Runs the real API against a real MongoDB.  MONGODB_URI=mongodb://127.0.0.1:27017/portfolio_test npm test
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
const run = uri ? describe : describe.skip;

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

run('portfolio API', () => {
  let server, base, cookie = '';
  const H = { 'X-Requested-With': 'portfolio' };

  before(async () => {
    Object.assign(process.env, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'secret-pass', JWT_SECRET: 'x'.repeat(40), CLIENT_ORIGIN: 'http://localhost:5173' });
    const { createApp } = await import('../src/app.js');
    const { config } = await import('../src/config.js');
    const { connect } = await import('../src/db.js');
    await connect();
    await mongoose.connection.dropDatabase();
    const { disconnect } = await import('../src/db.js');
    await disconnect();
    await connect(); // re-seed on an empty database
    server = createApp(config).listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server?.close();
    await mongoose.disconnect();
  });

  const call = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) } });

  test('public data is seeded on the first run', async () => {
    const d = await (await call('/api/public')).json();
    assert.equal(d.profile.name, 'Your Name');
    assert.equal(d.projects.length, 4);
    assert.ok(Array.isArray(d.projects[0].tags));
    assert.match(d.projects[0].id, /^[a-f0-9]{24}$/);
  });

  test('admin routes need a login', async () => {
    assert.equal((await call('/api/admin/data')).status, 401);
    assert.equal((await call('/api/admin/me')).status, 401);
  });

  test('wrong password is refused, right password sets an HttpOnly cookie', async () => {
    const bad = await call('/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'nope' }) });
    assert.equal(bad.status, 401);
    const ok = await call('/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'secret-pass' }) });
    assert.equal(ok.status, 200);
    const set = ok.headers.get('set-cookie');
    assert.match(set, /HttpOnly/i);
    cookie = set.split(';')[0];
  });

  test('changing data without the CSRF header or from a foreign origin is blocked', async () => {
    const form = new FormData(); form.set('title', 'x');
    assert.equal((await call('/api/admin/projects', { method: 'POST', body: form })).status, 403);
    const form2 = new FormData(); form2.set('title', 'x');
    assert.equal((await call('/api/admin/projects', { method: 'POST', headers: { ...H, Origin: 'https://evil.example' }, body: form2 })).status, 403);
  });

  test('create, edit and delete a project with an image', async () => {
    const form = new FormData();
    form.set('title', 'My App'); form.set('description', 'Hello'); form.set('link', 'https://example.com'); form.set('tags', 'React, Node.js, react');
    form.set('image', new Blob([PNG], { type: 'image/png' }), 'a.png');
    const res = await call('/api/admin/projects', { method: 'POST', headers: H, body: form });
    assert.equal(res.status, 201);
    const p = await res.json();
    assert.deepEqual(p.tags, ['React', 'Node.js']);
    assert.match(p.image, /^\/api\/img\/[a-f0-9]{32}\.png$/);

    const img = await call(p.image);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

    const edit = new FormData(); edit.set('title', 'My App 2'); edit.set('tags', 'Vue');
    const up = await (await call(`/api/admin/projects/${p.id}`, { method: 'PUT', headers: H, body: edit })).json();
    assert.equal(up.title, 'My App 2'); assert.equal(up.image, p.image);

    assert.equal((await call(`/api/admin/projects/${p.id}`, { method: 'DELETE', headers: H })).status, 200);
    assert.equal((await call(p.image)).status, 404); // the photo is removed together with the project
  });

  test('fake image and bad ids are refused', async () => {
    const form = new FormData(); form.set('title', 'Bad');
    form.set('image', new Blob([Buffer.from('not really an image at all')], { type: 'image/png' }), 'a.png');
    assert.equal((await call('/api/admin/projects', { method: 'POST', headers: H, body: form })).status, 400);
    assert.equal((await call('/api/admin/projects/123', { method: 'DELETE', headers: H })).status, 404);
  });

  test('profile can be updated and validated', async () => {
    const bad = new FormData(); bad.set('name', 'Ann'); bad.set('email', 'nope');
    assert.equal((await call('/api/admin/profile', { method: 'PUT', headers: H, body: bad })).status, 400);
    const f = new FormData(); f.set('name', 'Ann Lee'); f.set('title', 'Dev'); f.set('email', 'ann@example.com'); f.set('github', 'https://github.com/ann');
    f.set('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
    const p = await (await call('/api/admin/profile', { method: 'PUT', headers: H, body: f })).json();
    assert.equal(p.name, 'Ann Lee'); assert.ok(p.photo.startsWith('/api/img/'));
    const pub = await (await call('/api/public')).json();
    assert.equal(pub.profile.name, 'Ann Lee');
  });

  test('logout clears the session; 5 wrong attempts lock the login', async () => {
    await call('/api/admin/logout', { method: 'POST', headers: H });
    cookie = '';
    let last;
    for (let i = 0; i < 5; i++) last = await call('/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' + i }) });
    assert.equal(last.status, 429);
    const locked = await call('/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'secret-pass' }) });
    assert.equal(locked.status, 429);
  });
});

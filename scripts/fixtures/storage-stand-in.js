'use strict';

/**
 * SUPABASE STORAGE, A STAND-IN (docs/claude/duos.md), faithful to what Duos
 * calls of it and to how the real service answers, with NO network beyond
 * localhost:
 *
 *   storage.from(bucket).createSignedUploadUrl(path, { upsert })
 *        -> { data: { signedUrl, token, path } }   the URL a PUT goes to,
 *           `${url}/object/upload/sign/<bucket>/<path>?token=...`, two hours
 *   storage.from(bucket).createSignedUrl(path, expiresIn)
 *        -> { data: { signedUrl } } | { error: Object not found }
 *   storage.from(bucket).list(folder, { limit, offset, search })
 *        -> { data: [{ name, id, metadata: { size, mimetype } }] }   one level
 *   storage.from(bucket).remove([paths]) -> { data: [removed objects] }
 *
 * and an HTTP server for the two URLs: a PUT to a signed upload URL checks its
 * token (made for that bucket and path, not expired), the bucket's
 * file_size_limit (413) and allowed_mime_types (415), and an existing object
 * without upsert (409); a GET of a signed URL checks its token and expiry
 * (400) and answers the bytes. A missing bucket is "Bucket not found" (404),
 * as the real service says it.
 *
 *   createStorage({ buckets: { name: { fileSizeLimit, allowedMimeTypes } }, now })
 *     .listen() -> base URL; .close(); .objects (Map 'bucket/path' -> { bytes, type, at }); .calls
 */

const http = require('http');
const crypto = require('crypto');

const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

function createStorage(opts = {}) {
  const buckets = new Map(Object.entries(opts.buckets || {}));
  const now = opts.now || (() => Date.now());
  const objects = new Map();
  const tokens = new Map();     // token -> { kind, bucket, path, exp, upsert }
  const calls = [];
  let server = null;
  let base = 'http://127.0.0.1:0/storage/v1';
  const notFound = (what) => ({ data: null, error: { message: what, statusCode: '404', error: 'not_found' } });
  const token = (o) => { const t = crypto.randomBytes(16).toString('hex'); tokens.set(t, o); return t; };

  function from(bucket) {
    const b = () => buckets.get(bucket);
    return {
      async createSignedUploadUrl(path, o = {}) {
        calls.push({ op: 'signUpload', bucket, path });
        if (!b()) return notFound('Bucket not found');
        const t = token({ kind: 'up', bucket, path, exp: now() + UPLOAD_TTL_MS, upsert: !!o.upsert });
        return { data: { signedUrl: `${base}/object/upload/sign/${bucket}/${path}?token=${t}`, token: t, path }, error: null };
      },
      async createSignedUrl(path, expiresIn) {
        calls.push({ op: 'signDownload', bucket, path, expiresIn });
        if (!b()) return notFound('Bucket not found');
        if (!objects.has(`${bucket}/${path}`)) return notFound('Object not found');
        const t = token({ kind: 'down', bucket, path, exp: now() + Number(expiresIn) * 1000 });
        return { data: { signedUrl: `${base}/object/sign/${bucket}/${path}?token=${t}` }, error: null };
      },
      async list(folder, o = {}) {
        calls.push({ op: 'list', bucket, folder, search: o.search });
        if (!b()) return notFound('Bucket not found');
        const pre = folder ? `${bucket}/${folder.replace(/\/+$/, '')}/` : `${bucket}/`;
        const seen = new Map();
        for (const [k, v] of objects) {
          if (!k.startsWith(pre)) continue;
          const rest = k.slice(pre.length);
          const name = rest.split('/')[0];
          if (o.search && !name.includes(o.search)) continue;
          if (rest.includes('/')) { if (!seen.has(name)) seen.set(name, { name, id: null, metadata: null }); continue; }
          seen.set(name, { name, id: crypto.createHash('md5').update(k).digest('hex'), created_at: new Date(v.at).toISOString(), updated_at: new Date(v.at).toISOString(),
            metadata: { size: v.bytes.length, mimetype: v.type } });
        }
        const list = [...seen.values()].sort((x, y) => x.name.localeCompare(y.name));
        const off = Number(o.offset) || 0;
        return { data: list.slice(off, off + (Number(o.limit) || 100)), error: null };
      },
      async remove(paths) {
        calls.push({ op: 'remove', bucket, paths: paths.slice() });
        if (!b()) return notFound('Bucket not found');
        const gone = [];
        for (const p of paths) if (objects.delete(`${bucket}/${p}`)) gone.push({ name: p, bucket_id: bucket });
        return { data: gone, error: null };
      },
    };
  }

  function answer(res, status, body, type) {
    res.writeHead(status, { 'Content-Type': type || 'application/json' });
    res.end(type ? body : JSON.stringify(body));
  }
  function handler(req, res) {
    const u = new URL(req.url, 'http://stand.in');
    const t = tokens.get(u.searchParams.get('token') || '');
    const up = /^\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/.exec(u.pathname);
    const down = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (req.method === 'PUT' && up) {
      const [, bucket, path] = up;
      const chunks = [];
      let size = 0;
      const b = buckets.get(bucket);
      req.on('data', (c) => { size += c.length; if (!b || size <= b.fileSizeLimit + 1) chunks.push(c); });
      req.on('end', () => {
        calls.push({ op: 'PUT', bucket, path, size });
        if (!b) return answer(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
        if (!t || t.kind !== 'up' || t.bucket !== bucket || t.path !== path || now() > t.exp) return answer(res, 400, { statusCode: '400', error: 'InvalidJWT', message: 'invalid signature' });
        const type = String(req.headers['content-type'] || '');
        if (b.allowedMimeTypes && !b.allowedMimeTypes.includes(type)) return answer(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
        if (size > b.fileSizeLimit) return answer(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
        if (objects.has(`${bucket}/${path}`) && !t.upsert) return answer(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        objects.set(`${bucket}/${path}`, { bytes: Buffer.concat(chunks), type, at: now() });
        return answer(res, 200, { Key: `${bucket}/${path}`, Id: crypto.randomUUID() });
      });
      return;
    }
    if (req.method === 'GET' && down) {
      const [, bucket, path] = down;
      calls.push({ op: 'GET', bucket, path });
      if (!t || t.kind !== 'down' || t.bucket !== bucket || t.path !== path || now() > t.exp) return answer(res, 400, { statusCode: '400', error: 'InvalidJWT', message: 'jwt expired' });
      const o = objects.get(`${bucket}/${path}`);
      if (!o) return answer(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return answer(res, 200, o.bytes, o.type);
    }
    answer(res, 404, { statusCode: '404', error: 'not_found', message: 'route not found' });
  }

  return {
    from, objects, calls, tokens,
    listen() {
      return new Promise((resolve) => {
        server = http.createServer(handler).listen(0, '127.0.0.1', () => {
          base = `http://127.0.0.1:${server.address().port}/storage/v1`;
          resolve(base);
        });
      });
    },
    close() { if (server) server.close(); },
    /** Put a file as if an app had uploaded it (for the sweep's and the purge's cases). */
    put(bucket, path, bytes, type = 'video/x-matroska', at) { objects.set(`${bucket}/${path}`, { bytes: Buffer.from(bytes), type, at: at === undefined ? now() : at }); },
  };
}

module.exports = { createStorage, UPLOAD_TTL_MS };

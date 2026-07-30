#!/usr/bin/env node
/*
 * Local test proxy for the userscript.
 * Mirrors https://maplescouter.com on http://localhost:8787 and injects the
 * userscript + data payload into every HTML page *before* the site's own
 * scripts — the same timing Tampermonkey gives us with @run-at document-start.
 * Also tunnels api.maplescouter.com (origin-locked CORS) through /__api/.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = 8787;
const SITE = 'maplescouter.com';
const API = 'api.maplescouter.com';
const DIST = path.join(__dirname, '..', 'dist');

const INJECT = '<script src="/__msfix/msfix-data.js"></script><script src="/__msfix/maplescouter-en-fix.user.js"></script>';

function fetchUpstream(host, req, bodyChunks, cb) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['accept-encoding'];
  headers['accept-encoding'] = 'gzip';
  const options = {
    hostname: host,
    port: 443,
    path: req.url.replace(/^\/__api/, ''),
    method: req.method,
    headers: { ...headers, host, origin: 'https://' + SITE, referer: 'https://' + SITE + '/' },
  };
  const up = https.request(options, cb);
  up.on('error', (e) => cb(null, e));
  if (bodyChunks.length) up.write(Buffer.concat(bodyChunks));
  up.end();
}

const server = http.createServer((req, res) => {
  const bodyChunks = [];
  req.on('data', (c) => bodyChunks.push(c));
  req.on('end', () => {
    // 1. Local userscript files
    if (req.url.startsWith('/__msfix/')) {
      const file = path.join(DIST, path.basename(req.url.split('?')[0]));
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(file));
      } else { res.writeHead(404); res.end('missing ' + file); }
      return;
    }
    // 2. API tunnel
    const isApi = req.url.startsWith('/__api/');
    const host = isApi ? API : SITE;
    fetchUpstream(host, req, bodyChunks, (up, err) => {
      if (!up) { res.writeHead(502); res.end(String(err)); return; }
      const ct = up.headers['content-type'] || '';
      const isText = /html|javascript|json|css/.test(ct);
      const headers = { ...up.headers };
      delete headers['content-length'];
      delete headers['content-encoding'];
      delete headers['content-security-policy'];
      delete headers['strict-transport-security'];
      if (headers.location) headers.location = headers.location.replace('https://' + SITE, '');
      if (!isText) {
        res.writeHead(up.statusCode, headers);
        up.pipe(res);
        return;
      }
      const chunks = [];
      const stream = up.headers['content-encoding'] === 'gzip' ? up.pipe(zlib.createGunzip()) : up;
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        body = body.split('https://' + API).join('/__api');
        if (/html/.test(ct)) {
          body = body.replace(/<head([^>]*)>/i, '<head$1>' + INJECT);
        }
        res.writeHead(up.statusCode, headers);
        res.end(body);
      });
      stream.on('error', () => { res.writeHead(502); res.end('upstream decode error'); });
    });
  });
});

server.listen(PORT, () => console.log('MapleScouter test proxy on http://localhost:' + PORT));

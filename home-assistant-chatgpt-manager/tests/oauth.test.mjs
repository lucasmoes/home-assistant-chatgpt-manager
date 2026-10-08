import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes, generateKeyPairSync, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createBridge } from '../dist/app.js';
import { validatePublicUrl } from '../dist/config.js';
import { chatGptRedirect } from '../dist/oauth.js';

const issuer = 'https://manager.example.com';
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const password = 'test-password-only-32-characters-minimum';
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'auth-test', version: '1' } } };

async function fixture(t, clientId = 'home-assistant-manager') {
  const dir = mkdtempSync(join(tmpdir(), 'ha-oauth-'));
  const config = { port: 0, publicUrl: issuer, oauthRedirectUri: redirect, oauthDataDir: dir, allowLegacyApiKey: false, apiKey: password, writeAccess: false, logLevel: 'error', homeAssistantBaseUrl: 'http://127.0.0.1:1/api', homeAssistantWebSocketUrl: 'ws://127.0.0.1:1/websocket', homeAssistantToken: 'test-only' };
  let bridge, local;
  async function start() {
    bridge = createBridge(config); bridge.server.listen(0, '127.0.0.1'); await once(bridge.server, 'listening');
    local = `http://127.0.0.1:${bridge.server.address().port}`;
  }
  async function stop() {
    await new Promise(resolve => bridge.server.close(resolve)); await bridge.close();
  }
  await start();
  t.after(async () => { await stop(); rmSync(dir, { recursive: true, force: true }); });
  const cookies = new Map();
  async function request(path, options = {}) {
    const headers = { ...(cookies.size ? { Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') } : {}), ...options.headers };
    const response = await fetch(local + path, { ...options, headers, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const i = pair.indexOf('=');
      if (pair.slice(i+1)) cookies.set(pair.slice(0,i), pair.slice(i+1)); else cookies.delete(pair.slice(0,i));
    }
    return response;
  }
  const post = (path, data, extra = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(path.startsWith('/interaction/') ? { Origin: issuer } : {}), ...extra }, body: new URLSearchParams(data) });
  const authParams = () => {
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'ha:manage', resource: issuer + '/mcp', state: 'state-123', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return { verifier, params };
  };
  async function authorize({ deny = false } = {}) {
    cookies.clear();
    const { verifier, params } = authParams();
    let response = await request('/oauth/authorize?' + params);
    for (let step = 0; step < 12; step++) {
      const location = response.headers.get('location');
      if (location?.startsWith('https://chatgpt.com/')) {
        const url = new URL(location);
        assert.equal(url.searchParams.get('state'), 'state-123');
        assert.equal(url.searchParams.get('iss'), issuer);
        if (deny) { assert.equal(url.searchParams.get('error'), 'access_denied'); return {}; }
        assert.ok(url.searchParams.get('code'), location);
        return { code: url.searchParams.get('code'), verifier };
      }
      assert.ok(location, `No redirect: ${response.status} ${await response.text()}`);
      const path = location.startsWith('http') ? new URL(location).pathname + new URL(location).search : location;
      response = await request(path);
      if (response.status === 200) {
        const html = await response.text();
        const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
        assert.ok(csrf, html);
        const action = html.includes('name="password"') ? 'login' : deny ? 'deny' : 'allow';
        response = await post(path, { csrf, action, password });
      }
    }
    assert.fail('Authorization did not finish');
  }
  const exchange = async (code, verifier, extra = {}) => post('/oauth/token', { grant_type: 'authorization_code', client_id: 'home-assistant-manager', redirect_uri: redirect, code, code_verifier: verifier, resource: issuer + '/mcp', ...extra });
  const mcp = token => request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: JSON.stringify(init) });
  return { config, dir, request, post, authParams, authorize, exchange, mcp, async restart(change = {}) { await stop(); Object.assign(config, change); cookies.clear(); await start(); } };
}

test('OAuth discovery advertises S256, exact issuer/resource, CIMD; MCP rejects passwords and missing tokens', async t => {
  const f = await fixture(t);
  const discovery = await (await f.request('/.well-known/oauth-authorization-server')).json();
  assert.equal(discovery.issuer, issuer);
  assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
  assert.equal(discovery.authorization_response_iss_parameter_supported, true);
  assert.equal(discovery.client_id_metadata_document_supported, true);
  assert.equal(discovery.authorization_endpoint, issuer + '/oauth/authorize');
  const resource = await (await f.request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(resource.resource, issuer + '/mcp');
  const r = await f.mcp(password); assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /resource_metadata=/);
  assert.equal((await f.request('/mcp', { method: 'POST' })).status, 401);
  assert.equal(statSync(join(f.dir, 'oauth.sqlite')).mode & 0o777, 0o600);
});

test('browser login, consent, token, MCP access, restart persistence, refresh rotation and replay revocation', async t => {
  const f = await fixture(t);
  const { code, verifier } = await f.authorize();
  const r = await f.exchange(code, verifier); const token = await r.json();
  assert.equal(r.status, 200, JSON.stringify(token)); assert.ok(token.access_token); assert.ok(token.refresh_token);
  assert.equal(token.expires_in, 600);
  assert.equal((await f.mcp(token.access_token)).status, 200);
  await f.restart();
  assert.equal((await f.mcp(token.access_token)).status, 200);
  const refreshed = await f.post('/oauth/token', { grant_type: 'refresh_token', client_id: 'home-assistant-manager', refresh_token: token.refresh_token, resource: issuer + '/mcp' });
  const second = await refreshed.json(); assert.equal(refreshed.status, 200, JSON.stringify(second));
  assert.notEqual(second.refresh_token, token.refresh_token);
  assert.equal((await f.mcp(second.access_token)).status, 200);
  const replay = await f.post('/oauth/token', { grant_type: 'refresh_token', client_id: 'home-assistant-manager', refresh_token: token.refresh_token });
  assert.equal(replay.status, 400);
  assert.equal((await f.mcp(second.access_token)).status, 401);
});

test('rejects wrong PKCE, reused code, wrong resource, and revokes tokens', async t => {
  const f = await fixture(t);
  let auth = await f.authorize();
  assert.equal((await f.exchange(auth.code, 'a'.repeat(43))).status, 400);
  auth = await f.authorize();
  assert.equal((await f.exchange(auth.code, auth.verifier, { resource: 'https://other.example/mcp' })).status, 400);
  auth = await f.authorize();
  const token = await (await f.exchange(auth.code, auth.verifier)).json();
  assert.equal((await f.exchange(auth.code, auth.verifier)).status, 400);
  auth = await f.authorize();
  const active = await (await f.exchange(auth.code, auth.verifier)).json();
  assert.equal((await f.mcp(active.access_token)).status, 200);
  const revoke = await f.post('/oauth/revoke', { client_id: 'home-assistant-manager', token: active.access_token, token_type_hint: 'access_token' });
  assert.equal(revoke.status, 200);
  assert.equal((await f.mcp(active.access_token)).status, 401);
  assert.ok(token.access_token);
});

test('password or write policy changes invalidate existing grants', async t => {
  const f = await fixture(t);
  const auth = await f.authorize(); const token = await (await f.exchange(auth.code, auth.verifier)).json();
  assert.ok(token.access_token);
  assert.equal((await f.mcp(token.access_token)).status, 200);
  await f.restart({ apiKey: password + '-rotated' });
  assert.equal((await f.mcp(token.access_token)).status, 401);
  const auth2 = await f.authorize().catch(() => null); // old password must now fail
  assert.equal(auth2, null);
});

test('rejects unsafe redirects, non-PKCE authorization, CSRF, bad password and arbitrary CIMD clients', async t => {
  const f = await fixture(t);
  let { params } = f.authParams(); params.set('redirect_uri', 'https://evil.example/callback');
  let r = await f.request('/oauth/authorize?' + params); assert.equal(r.status, 400); assert.equal(r.headers.get('location'), null);
  ({ params } = f.authParams()); params.delete('code_challenge'); params.delete('code_challenge_method');
  r = await f.request('/oauth/authorize?' + params); assert.ok([303,302,400].includes(r.status));
  assert.ok(r.status === 400 || new URL(r.headers.get('location')).searchParams.has('error'));
  ({ params } = f.authParams()); params.set('client_id', 'https://127.0.0.1/client.json');
  r = await f.request('/oauth/authorize?' + params); assert.equal(r.status, 400);
  ({ params } = f.authParams());
  r = await f.request('/oauth/authorize?' + params);
  const path = new URL(r.headers.get('location'), issuer).pathname;
  r = await f.request(path); const html = await r.text(); const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
  assert.equal((await f.post(path, { csrf, action: 'login', password }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post(path, { csrf: 'wrong', action: 'login', password })).status, 403);
  assert.equal((await f.post(path, { csrf, action: 'login', password: 'wrong' })).status, 401);
  assert.equal((await f.post(path, { csrf, action: 'login', password: 'x'.repeat(5000) })).status, 413);
});

test('owner may deny consent without issuing a code', async t => { await (await fixture(t)).authorize({ deny: true }); });

test('configuration only accepts HTTPS origins and exact ChatGPT callback paths', () => {
  assert.equal(validatePublicUrl('https://example.com/'), 'https://example.com');
  for (const url of ['http://example.com', 'https://example.com/mcp', 'https://user:pass@example.com', 'https://example.com/?x=1']) assert.throws(() => validatePublicUrl(url));
  assert.equal(chatGptRedirect(redirect), true);
  for (const url of ['https://chatgpt.com.evil.com/connector_platform_oauth_redirect', redirect+'?next=https://evil.com', 'http://chatgpt.com/connector_platform_oauth_redirect']) assert.equal(chatGptRedirect(url), false);
});


test('CIMD discovery and signed client authentication complete without a desktop client', async t => {
  const clientId = 'https://chatgpt.com/oauth/client.json';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url === clientId) return Response.json({ client_id: clientId, redirect_uris: [redirect], token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_signing_alg: 'RS256', jwks_uri: 'https://chatgpt.com/oauth/jwks.json', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    if (url === 'https://chatgpt.com/oauth/jwks.json') return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
    return originalFetch(input, options);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const f = await fixture(t, clientId);
  const auth = await f.authorize();
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  const signingInput = b64({ alg: 'RS256', kid: 'test-key' }) + '.' + b64({ iss: clientId, sub: clientId, aud: issuer + '/oauth/token', iat: now, exp: now + 60, jti: randomBytes(16).toString('hex') });
  const assertion = signingInput + '.' + sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const result = await f.exchange(auth.code, auth.verifier, { client_id: clientId, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion });
  const tokens = await result.json();
  assert.equal(result.status, 200, JSON.stringify(tokens));
  assert.equal((await f.mcp(tokens.access_token)).status, 200);
  const replay = await f.post('/oauth/token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion });
  assert.equal(replay.status, 401);
});

test('expired tokens, missing scope, and increased write permissions require authorization', async t => {
  const f = await fixture(t);
  let auth = await f.authorize(); let token = await (await f.exchange(auth.code, auth.verifier)).json();
  assert.equal((await f.mcp(token.access_token)).status, 200);
  const db = new DatabaseSync(join(f.dir, 'oauth.sqlite')); t.after(() => db.close());
  db.prepare("UPDATE records SET expires = 1 WHERE model = 'AccessToken'").run();
  assert.equal((await f.mcp(token.access_token)).status, 401);
  auth = await f.authorize(); token = await (await f.exchange(auth.code, auth.verifier)).json();
  db.prepare("UPDATE records SET payload = json_set(payload, '$.scope', '') WHERE model = 'AccessToken'").run();
  assert.equal((await f.mcp(token.access_token)).status, 401);
  auth = await f.authorize(); token = await (await f.exchange(auth.code, auth.verifier)).json();
  assert.equal((await f.mcp(token.access_token)).status, 200);
  const write = await f.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_automation', arguments: { config: { alias: 'Must not create', triggers: [], conditions: [], actions: [] } } } }) });
  const result = await write.text(); assert.match(result, /write_access|disabled/i);
  await f.restart({ writeAccess: true });
  assert.equal((await f.mcp(token.access_token)).status, 401);
});

test('login attempts are bounded and bearer compatibility is explicit opt-in', async t => {
  const f = await fixture(t);
  const { params } = f.authParams(); const start = await f.request('/oauth/authorize?' + params);
  const path = new URL(start.headers.get('location'), issuer).pathname;
  const html = await (await f.request(path)).text(); const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
  for (let i = 0; i < 20; i++) assert.equal((await f.post(path, { csrf, action: 'login', password: 'bad' })).status, 401);
  assert.equal((await f.post(path, { csrf, action: 'login', password })).status, 429);
  assert.equal((await f.mcp(password)).status, 401);
  await f.restart({ allowLegacyApiKey: true });
  assert.equal((await f.mcp(password)).status, 200);
});

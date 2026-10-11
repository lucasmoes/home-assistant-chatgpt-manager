import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes, generateKeyPairSync, sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createBridge } from '../dist/app.js';
import { loadConfig, validatePublicUrl } from '../dist/config.js';
import { chatGptRedirect, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT_URI } from '../dist/oauth.js';

import { parseClients, validRedirect } from '../dist/oauth-clients.js';

const issuer = 'https://manager.example.com';
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const password = 'test-password-only-32-characters-minimum';
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'auth-test', version: '1' } } };

async function fixture(t, clientId = 'home-assistant-manager', callback = redirect, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ha-oauth-'));
  const config = { port: 0, publicUrl: issuer, oauthRedirectUri: redirect, oauthDataDir: dir, allowLegacyApiKey: false, apiKey: password, writeAccess: false, logLevel: 'error', homeAssistantBaseUrl: 'http://127.0.0.1:1/api', homeAssistantWebSocketUrl: 'ws://127.0.0.1:1/websocket', homeAssistantToken: 'test-only', ...overrides };
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
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'ha:manage', resource: issuer + '/mcp', state: 'state-123', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return { verifier, params };
  };
  async function authorize({ deny = false, inspectConsent } = {}) {
    cookies.clear();
    const { verifier, params } = authParams();
    let response = await request('/oauth/authorize?' + params);
    for (let step = 0; step < 12; step++) {
      const location = response.headers.get('location');
      if (location && new URL(location, issuer).origin === new URL(callback).origin) {
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
        if (!html.includes('name="password"')) inspectConsent?.(html, response.headers);
        const action = html.includes('name="password"') ? 'login' : deny ? 'deny' : 'allow';
        response = await post(path, { csrf, action, password });
      }
    }
    assert.fail('Authorization did not finish');
  }
  const exchange = async (code, verifier, extra = {}) => post('/oauth/token', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback, code, code_verifier: verifier, resource: issuer + '/mcp', ...extra });
  const mcp = token => request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: JSON.stringify(init) });
  return { config, dir, selectClient(id, uri) { clientId = id; callback = uri; }, request, post, authParams, authorize, exchange, mcp, async restart(change = {}) { await stop(); Object.assign(config, change); cookies.clear(); await start(); } };
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

test('OAuth-authenticated clients initialize and discover all tools without a session id', async t => {
  const f = await fixture(t);
  const { code, verifier } = await f.authorize();
  const tokens = await (await f.exchange(code, verifier)).json();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tokens.access_token}`, 'MCP-Protocol-Version': '2025-03-26' };
  const call = body => f.request('/mcp', { method: 'POST', headers, body: JSON.stringify(body) });
  const read = async response => {
    assert.equal(response.status, 200);
    const text = await response.text();
    return JSON.parse(text.split('\n').find(line => line.startsWith('data: ')).slice(6));
  };
  const initialized = await call(init);
  assert.equal(initialized.headers.get('mcp-session-id'), null);
  assert.equal((await read(initialized)).result.protocolVersion, '2025-03-26');
  assert.equal((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const listed = await read(await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
  assert.equal(listed.result.tools.length, 18);
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.name && tool.description);
  }
  assert.ok(listed.result.tools.some(tool => tool.name === 'create_automation'));
  assert.ok(listed.result.tools.some(tool => tool.name === 'get_home_overview'));
});

test('MCP diagnostics distinguish token and origin failures without logging credentials or request data', async t => {
  const f = await fixture(t);
  const lines = [];
  const original = console.info;
  console.info = line => lines.push(line);
  try {
    assert.equal((await f.request('/mcp')).status, 401);
    assert.equal((await f.request('/mcp?private-query', { method: 'POST', headers: { Authorization: 'Bearer secret-test-token', 'Content-Type': 'application/json' }, body: '{"private":"request-data"}' })).status, 401);
    assert.equal((await f.request('/mcp', { headers: { Origin: 'https://private-origin.example' } })).status, 403);
    const { code, verifier } = await f.authorize();
    const tokens = await (await f.exchange(code, verifier)).json();
    const response = await f.mcp(tokens.access_token);
    await response.text();
    const log = lines.join('\n');
    assert.match(log, /status=401 access=missing-token/);
    assert.match(log, /status=401 access=token-rejected/);
    assert.match(log, /status=403 access=origin-rejected/);
    assert.match(log, /status=200 access=accepted/);
    for (const secret of [password, tokens.access_token, 'secret-test-token', 'private-query', 'request-data', 'private-origin.example']) assert.equal(log.includes(secret), false);
  } finally { console.info = original; }
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

test('login and consent forms preserve browser Origin while rejecting null, missing and foreign origins', async t => {
  const f = await fixture(t);
  const { params } = f.authParams();
  let response = await f.request('/oauth/authorize?' + params);
  const loginPath = new URL(response.headers.get('location'), issuer).pathname;
  response = await f.request(loginPath);
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  const html = await response.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
  for (const origin of ['null', 'https://evil.example', undefined]) {
    const rejected = await f.request(loginPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin === undefined ? {} : { Origin: origin }) },
      body: new URLSearchParams({ csrf, action: 'login', password }),
    });
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).error, 'invalid_origin');
  }
  response = await f.post(loginPath, { csrf, action: 'login', password });
  // Follow the authorization resume redirect to the consent interaction.
  for (let step = 0; step < 4 && response.status !== 200; step++) {
    const location = new URL(response.headers.get('location'), issuer);
    response = await f.request(location.pathname + location.search);
  }
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert.match(await response.text(), /Allow connection/);
  const discovery = await f.request('/.well-known/oauth-authorization-server');
  assert.equal(discovery.headers.get('referrer-policy'), 'no-referrer');
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


test('Claude OAuth client is registered without changing ChatGPT OAuth', async t => {
  const f = await fixture(t);
  assert.equal(CLAUDE_CLIENT_ID, 'home-assistant-manager-claude');
  assert.equal(CLAUDE_REDIRECT_URI, 'https://claude.ai/api/mcp/auth_callback');
  const claude = await f.request('/oauth/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: CLAUDE_CLIENT_ID, redirect_uri: CLAUDE_REDIRECT_URI,
    scope: 'ha:manage', state: 'claude-test', code_challenge: createHash('sha256').update('a'.repeat(43)).digest('base64url'),
    code_challenge_method: 'S256', resource: issuer + '/mcp'
  }));
  assert.ok([302, 303].includes(claude.status));
  assert.match(claude.headers.get('location') ?? '', /interaction/);
  const wrong = await f.request('/oauth/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: CLAUDE_CLIENT_ID, redirect_uri: redirect,
    scope: 'ha:manage', state: 'wrong', code_challenge: createHash('sha256').update('a'.repeat(43)).digest('base64url'),
    code_challenge_method: 'S256', resource: issuer + '/mcp'
  }));
  assert.equal(wrong.status, 400);
});


for (const [name, id, callback, config] of [
  ['Claude', CLAUDE_CLIENT_ID, CLAUDE_REDIRECT_URI, {}],
  ['Generic client', 'other-ai', 'https://other.example/callback', { oauthClients: parseClients(JSON.stringify([
    { client_id: 'other-ai', client_name: 'Other <AI>', redirect_uris: ['https://other.example/callback'] },
  ])) }],
  ['Loopback client', 'local-ai', 'http://localhost:8766/oauth/callback', { oauthClients: parseClients(JSON.stringify([
    { client_id: 'local-ai', client_name: 'Local AI', redirect_uris: ['http://localhost:8766/oauth/callback'] },
  ])) }],
]) {
  test(`${name}: complete consent, MCP, persistence, refresh and client isolation`, async t => {
    const f = await fixture(t, id, callback, config);
    const auth = await f.authorize({ inspectConsent(html, headers) {
      assert.ok(html.includes(callback));
      assert.ok(!html.includes('Allow ChatGPT'));
      assert.match(html, /names are labels/);
      assert.ok(headers.get('content-security-policy').includes(new URL(callback).origin));
      if (id === 'other-ai') { assert.match(html, /Other &lt;AI&gt;/); assert.ok(!html.includes('Other <AI>')); }
    } });
    assert.equal((await f.exchange(auth.code, auth.verifier, { client_id: 'home-assistant-manager' })).status, 400);
    const next = await f.authorize();
    const response = await f.exchange(next.code, next.verifier);
    const token = await response.json(); assert.equal(response.status, 200, JSON.stringify(token));
    assert.equal((await f.mcp(token.access_token)).status, 200);
    await f.restart();
    assert.equal((await f.mcp(token.access_token)).status, 200);
    assert.equal((await f.post('/oauth/token', { grant_type: 'refresh_token', client_id: 'home-assistant-manager', refresh_token: token.refresh_token })).status, 400);
    const refreshed = await f.post('/oauth/token', { grant_type: 'refresh_token', client_id: id, refresh_token: token.refresh_token, resource: issuer + '/mcp' });
    assert.equal(refreshed.status, 200);
    const second = await refreshed.json(); assert.notEqual(second.refresh_token, token.refresh_token);
    assert.equal((await f.mcp(second.access_token)).status, 200);
    assert.equal((await f.post('/oauth/revoke', { client_id: id, token: second.access_token })).status, 200);
    assert.equal((await f.mcp(second.access_token)).status, 401);
  });
}

const register = (f, metadata) => f.request('/oauth/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata),
});
const registration = { client_name: 'Example AI', redirect_uris: ['https://example.ai/callback'],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };

test('DCR is opt-in; enabled discovery, public and confidential registration survive restart', async t => {
  const f = await fixture(t);
  assert.equal((await (await f.request('/.well-known/oauth-authorization-server')).json()).registration_endpoint, undefined);
  assert.equal((await register(f, registration)).status, 404);
  await f.restart({ oauthDynamicRegistration: true });
  const discovery = await (await f.request('/.well-known/oauth-authorization-server')).json();
  assert.equal(discovery.registration_endpoint, issuer + '/oauth/register');
  for (const method of ['none', 'client_secret_basic', 'client_secret_post']) {
    assert.ok(discovery.token_endpoint_auth_methods_supported.includes(method));
    const response = await register(f, { ...registration, token_endpoint_auth_method: method });
    const client = await response.json(); assert.equal(response.status, 201, JSON.stringify(client));
    assert.ok(client.client_id); assert.equal(client.registration_access_token, undefined);
    if (method === 'none') assert.equal(client.client_secret, undefined); else assert.ok(client.client_secret);
    f.selectClient(client.client_id, registration.redirect_uris[0]);
    await f.restart();
    const auth = await f.authorize();
    const body = { grant_type: 'authorization_code', code: auth.code, code_verifier: auth.verifier,
      redirect_uri: registration.redirect_uris[0], resource: issuer + '/mcp' };
    let exchanged;
    if (method === 'client_secret_basic') {
      exchanged = await f.post('/oauth/token', body, { Authorization: 'Basic ' + Buffer.from(client.client_id + ':' + client.client_secret).toString('base64') });
    } else {
      exchanged = await f.post('/oauth/token', { ...body, client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}) });
    }
    const token = await exchanged.json(); assert.equal(exchanged.status, 200, JSON.stringify(token));
    assert.equal((await f.mcp(token.access_token)).status, 200);
    const refreshed = await f.post('/oauth/token', { grant_type: 'refresh_token', refresh_token: token.refresh_token,
      ...(method === 'client_secret_basic' ? {} : { client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}) }) },
      method === 'client_secret_basic' ? { Authorization: 'Basic ' + Buffer.from(client.client_id + ':' + client.client_secret).toString('base64') } : {});
    assert.equal(refreshed.status, 200, await refreshed.text());
  }
});

test('DCR rejects dangerous metadata and grants, bounds registration rate and storage', async t => {
  const f = await fixture(t, undefined, undefined, { oauthDynamicRegistration: true });
  for (const bad of [
    { redirect_uris: ['http://evil.example/callback'] }, { redirect_uris: ['https://evil.example/#fragment'] },
    { redirect_uris: ['https://*.example/callback'] }, { redirect_uris: ['https://user:pass@example.com/'] },
    { grant_types: ['client_credentials'] }, { response_types: ['token'] },
    { jwks_uri: 'http://127.0.0.1/keys' }, { sector_identifier_uri: 'http://127.0.0.1/private' },
    { token_endpoint_auth_method: 'private_key_jwt' }, { scope: 'admin' },
  ]) {
    const response = await register(f, { ...registration, ...bad }); assert.equal(response.status, 400, await response.text());
  }
  assert.equal((await register(f, registration)).status, 429);
  await f.restart();
  const db = new DatabaseSync(join(f.dir, 'oauth.sqlite')); t.after(() => db.close());
  const insert = db.prepare("INSERT INTO records(model,id,payload) VALUES('Client',?, '{}')");
  for (let i = 0; i < 100; i++) insert.run('capacity-' + i);
  assert.equal((await register(f, registration)).status, 429);
});

test('DCR body size, callback binding, PKCE, denial and policy reset', async t => {
  const f = await fixture(t, undefined, undefined, { oauthDynamicRegistration: true });
  assert.equal((await register(f, { ...registration, client_name: 'a'.repeat(60000) })).status, 400);
  const response = await register(f, { ...registration, redirect_uris: ['http://127.0.0.1:9876/callback'] });
  const client = await response.json(); assert.equal(response.status, 201, JSON.stringify(client));
  f.selectClient(client.client_id, client.redirect_uris[0]);
  let { params } = f.authParams(); params.set('redirect_uri', 'http://127.0.0.1:9877/callback');
  assert.equal((await f.request('/oauth/authorize?' + params)).status, 400);
  ({ params } = f.authParams()); params.delete('code_challenge'); params.delete('code_challenge_method');
  const missingPkce = await f.request('/oauth/authorize?' + params);
  assert.ok(missingPkce.status === 400 || new URL(missingPkce.headers.get('location')).searchParams.has('error'));
  await f.authorize({ deny: true });
  let auth = await f.authorize(); assert.equal((await f.exchange(auth.code, 'x'.repeat(43))).status, 400);
  auth = await f.authorize(); const token = await (await f.exchange(auth.code, auth.verifier)).json();
  assert.equal((await f.mcp(token.access_token)).status, 200);
  await f.restart({ oauthDynamicRegistration: false });
  assert.equal((await f.mcp(token.access_token)).status, 401);
  assert.equal((await f.request('/oauth/authorize?' + f.authParams().params)).status, 400);
});

test('additional client configuration validates IDs, callbacks and legacy defaults', () => {
  const client = { client_id: 'example', client_name: 'Example', redirect_uris: ['https://example.org/callback'] };
  for (const callback of ['https://example.org/callback?tenant=1', 'http://localhost:1234/callback', 'http://127.0.0.1:1234/callback', 'http://[::1]:1234/callback']) assert.equal(validRedirect(callback), true);
  for (const callback of ['javascript:alert(1)', 'http://192.168.1.2/callback', 'https://example.org/#', 'https://*.example.org/', 'https://user@example.org/', 'https://example.org/\\callback']) assert.equal(validRedirect(callback), false);
  for (const value of ['{}', 'null', '[null]', JSON.stringify([client, client]), JSON.stringify([{ ...client, client_id: 'home-assistant-manager' }]), JSON.stringify([{ ...client, client_secret: 'no' }]), JSON.stringify([{ ...client, redirect_uris: ['http://example.org/'] }])]) assert.throws(() => parseClients(value));
  assert.equal(parseClients(JSON.stringify([client]))[0].token_endpoint_auth_method, 'none');
  const original = { ...process.env };
  try {
    process.env.HA_TOKEN = 'test'; process.env.BRIDGE_API_KEY = password;
    delete process.env.OAUTH_CLIENTS; delete process.env.OAUTH_DYNAMIC_REGISTRATION; delete process.env.OAUTH_REDIRECT_URI;
    assert.deepEqual(loadConfig().oauthClients, []); assert.equal(loadConfig().oauthDynamicRegistration, false);
    assert.equal(loadConfig().oauthRedirectUri, redirect);
    process.env.OAUTH_CLIENTS = JSON.stringify([client]); process.env.OAUTH_DYNAMIC_REGISTRATION = 'true';
    assert.equal(loadConfig().oauthClients[0].client_id, 'example'); assert.equal(loadConfig().oauthDynamicRegistration, true);
  } finally { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); }
});


test('registration aliases cannot bypass policy/rate limits; native loopback ports remain supported', async t => {
  const f = await fixture(t, undefined, undefined, { oauthDynamicRegistration: true });
  for (const path of ['/oauth/register/', '/oauth/REGISTER', '/oauth/Register/']) {
    const response = await f.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...registration, jwks_uri: 'http://127.0.0.1/' }) });
    assert.equal(response.status, 404);
  }
  const response = await register(f, { ...registration, application_type: 'native', redirect_uris: ['http://127.0.0.1/callback'] });
  const client = await response.json(); assert.equal(response.status, 201, JSON.stringify(client));
  f.selectClient(client.client_id, 'http://127.0.0.1:9876/callback');
  const auth = await f.authorize(); const tokens = await (await f.exchange(auth.code, auth.verifier)).json();
  assert.equal((await f.mcp(tokens.access_token)).status, 200);
});

test('empty new defaults preserve legacy state; configured client changes revoke grants', async t => {
  const f = await fixture(t);
  const auth = await f.authorize(); const tokens = await (await f.exchange(auth.code, auth.verifier)).json();
  const db = new DatabaseSync(join(f.dir, 'oauth.sqlite')); t.after(() => db.close());
  const legacyFingerprint = createHash('sha256').update(JSON.stringify([issuer, password, redirect, false])).digest('hex');
  assert.equal(db.prepare("SELECT value FROM settings WHERE id = 'context'").get().value, legacyFingerprint);
  await f.restart({ oauthClients: [], oauthDynamicRegistration: false });
  assert.equal((await f.mcp(tokens.access_token)).status, 200);
  await f.restart({ oauthClients: parseClients(JSON.stringify([{ client_id: 'new-ai', client_name: 'New AI', redirect_uris: ['https://example.ai/callback'] }])) });
  assert.equal((await f.mcp(tokens.access_token)).status, 401);
});

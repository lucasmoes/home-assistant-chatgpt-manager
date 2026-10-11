import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { DatabaseSync } from "node:sqlite";
import { ChangeManager, clientContext } from "../dist/changes.js";
import { ChangeTargets } from "../dist/change-targets.js";
import {
  HomeAssistantClient,
  HomeAssistantError,
} from "../dist/home-assistant.js";
import { OwnerReview } from "../dist/owner-review.js";
import { registerSetupTools } from "../dist/setup-tools.js";
import { references, redact } from "../dist/diagnostics.js";
import { validateSpec } from "../dist/change-spec.js";

const issuer = "https://manager.example.com";
const proposal = {
  kind: "script",
  action: "update",
  id: "test",
  data: { alias: "After", sequence: [] },
};
function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ha-changes-"));
  let current = { alias: "Before", sequence: [] },
    writes = 0,
    fail = false;
  const ha = {
    getStates: async () => [{ entity_id: "light.test", state: "on" }],
    listEntityRegistry: async () => [{ entity_id: "light.test" }],
    request: async (path, init) => {
      if (path === "/services")
        return [{ domain: "light", services: { turn_on: {} } }];
      if (init?.method === "POST") {
        writes++;
        current = JSON.parse(init.body);
        if (fail) throw Error("timeout");
        return {};
      }
      return structuredClone(current);
    },
  };
  const config = {
    oauthDataDir: dir,
    writeAccess: true,
    publicUrl: issuer,
    approvalPassword: "separate-owner-password-32-characters",
    homeAssistantBaseUrl: "http://ha/api",
    homeAssistantToken: "ha-secret",
    apiKey: "connection-password",
    ...overrides,
  };
  let manager = new ChangeManager(new ChangeTargets(ha), config);
  t.after(() => {
    manager.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get manager() {
      return manager;
    },
    ha,
    config,
    dir,
    get writes() {
      return writes;
    },
    setCurrent(v) {
      current = v;
    },
    fail() {
      fail = true;
    },
    restart(patch = {}) {
      manager.close();
      Object.assign(config, patch);
      manager = new ChangeManager(new ChangeTargets(ha), config);
    },
  };
}
const asClient = (name, fn) => clientContext.run(name, fn);

test("preview never writes; only owner-approved exact proposal can apply, persist snapshots and restore", async (t) => {
  const f = fixture(t);
  const r = await asClient("claude", () => f.manager.propose(proposal));
  assert.equal(f.writes, 0);
  assert.equal(r.status, "pending");
  assert.match(r.review_url, /\/manage\?change=/);
  assert.ok(r.changes.length);
  await assert.rejects(
    asClient("claude", () => f.manager.apply(r.id)),
    /owner approval/,
  );
  f.manager.approve(r.id, true);
  await assert.rejects(
    asClient("other", () => f.manager.apply(r.id)),
    /another client/,
  );
  f.restart();
  const applied = await asClient("claude", () => f.manager.apply(r.id));
  assert.equal(applied.status, "applied");
  assert.equal(f.writes, 1);
  await assert.rejects(
    asClient("claude", () => f.manager.apply(r.id)),
    /already been attempted/,
  );
  const versions = f.manager.versions();
  assert.equal(versions.length, 2);
  const before = versions.find((v) => v.phase === "before");
  const restore = await asClient("claude", () => f.manager.restore(before.id));
  assert.equal(restore.spec.data.alias, "Before");
  assert.equal(f.writes, 1);
  f.manager.approve(restore.id, true);
  await asClient("claude", () => f.manager.apply(restore.id));
  assert.equal(f.writes, 2);
  assert.ok(
    f.manager
      .history()
      .some((e) => e.actor === "owner-browser" && e.event === "approved"),
  );
  assert.ok(
    f.manager
      .history()
      .some((e) => e.actor === "claude" && e.event === "apply_finished"),
  );
  assert.equal(
    statSync(join(f.dir, "changes", "changes.sqlite")).mode & 0o777,
    0o600,
  );
});

test("stale originals reject without writing and require new approval", async (t) => {
  const f = fixture(t);
  const r = await f.manager.propose(proposal);
  f.manager.approve(r.id, true);
  f.setCurrent({ alias: "Someone else changed this", sequence: [] });
  await assert.rejects(f.manager.apply(r.id), /changed since preview/);
  assert.equal(f.writes, 0);
  assert.equal(f.manager.get(r.id).status, "stale");
});

test("concurrent/repeated apply makes only one write", async (t) => {
  const f = fixture(t);
  const r = await f.manager.propose(proposal);
  f.manager.approve(r.id, true);
  const results = await Promise.allSettled([
    f.manager.apply(r.id),
    f.manager.apply(r.id),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.writes, 1);
});

test("failed/uncertain writes retain original snapshot and cannot be retried", async (t) => {
  const f = fixture(t);
  const r = await f.manager.propose(proposal);
  f.manager.approve(r.id, true);
  f.fail();
  assert.equal((await f.manager.apply(r.id)).status, "uncertain");
  assert.equal(f.manager.versions()[0].phase, "before");
  await assert.rejects(f.manager.apply(r.id), /already been attempted/);
  assert.equal(f.writes, 1);
});

test("restart revokes approvals on owner credential change; interrupted writes become uncertain", async (t) => {
  const f = fixture(t);
  const r = await f.manager.propose(proposal);
  f.manager.approve(r.id, true);
  f.restart({ approvalPassword: "different-owner-password-32-characters" });
  assert.equal(f.manager.get(r.id).status, "revoked");
  const r2 = await f.manager.propose(proposal);
  const db = new DatabaseSync(join(f.dir, "changes", "changes.sqlite"));
  r2.status = "applying";
  db.prepare("UPDATE changes SET payload=? WHERE id=?").run(
    JSON.stringify(r2),
    r2.id,
  );
  db.close();
  f.restart();
  assert.equal(f.manager.get(r2.id).status, "uncertain");
});

test("read-only, missing owner setup, rejected and expired proposals cannot write", async (t) => {
  const f = fixture(t, { writeAccess: false });
  await assert.rejects(f.manager.propose(proposal), /disabled/);
  f.restart({ writeAccess: true, approvalPassword: undefined });
  await assert.rejects(f.manager.propose(proposal), /approval_password/);
  f.restart({ approvalPassword: "owner-password-32-characters-long" });
  const r = await f.manager.propose(proposal);
  f.manager.approve(r.id, false);
  await assert.rejects(f.manager.apply(r.id), /owner approval/);
  const expired = await f.manager.propose(proposal);
  const db = new DatabaseSync(join(f.dir, "changes", "changes.sqlite"));
  expired.expires = 1;
  db.prepare("UPDATE changes SET payload=? WHERE id=?").run(
    JSON.stringify(expired),
    expired.id,
  );
  db.close();
  assert.throws(() => f.manager.approve(expired.id, true), /expired/);
  assert.equal(f.writes, 0);
});

test("preflight catches unknown literal references, forbidden target fields and construction races", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.manager.propose({
      ...proposal,
      data: {
        sequence: [
          { action: "light.turn_off", target: { entity_id: "light.missing" } },
        ],
      },
    }),
    /Unknown references/,
  );
  await assert.rejects(
    f.manager.propose(proposal, { alias: "older" }),
    /constructing/,
  );
  assert.throws(() =>
    validateSpec({
      kind: "device",
      action: "update",
      id: "d",
      data: { disabled_by: "user" },
    }),
  );
  assert.throws(
    () =>
      validateSpec({
        kind: "script",
        action: "update",
        id: "test",
        data: { id: "other", sequence: [] },
      }),
    /must match/,
  );
  assert.throws(() =>
    validateSpec({
      kind: "helper",
      action: "create",
      domain: "input_number",
      data: { name: "Number", min: 10, max: 0 },
    }),
  );
  assert.throws(() =>
    validateSpec({
      kind: "zone",
      action: "create",
      data: { name: "Outside", latitude: 200, longitude: 0 },
    }),
  );
});

test("reference extraction and log redaction handle nested targets, scenes and known secrets", () => {
  const refs = references({
    entities: { "light.test": "on" },
    actions: [
      {
        action: "light.turn_on",
        target: { entity_id: ["light.one", "light.two"] },
      },
      { delay: "{{ time }}" },
    ],
  });
  assert.deepEqual(refs.entities, ["light.test", "light.one", "light.two"]);
  assert.deepEqual(refs.services, ["light.turn_on"]);
  assert.equal(refs.templates, true);
  const clean = JSON.stringify(
    redact(
      {
        password: "x",
        message: "Bearer abc token=xyz known-secret eyJabc.abc.def",
      },
      ["known-secret"],
    ),
  );
  assert.ok(!clean.includes("known-secret"));
  assert.ok(!clean.includes("xyz"));
  assert.ok(!clean.includes("Bearer abc"));
});

test("owner UI authenticates separately, escapes configuration, enforces origin/CSRF and never applies", async (t) => {
  const f = fixture(t);
  const r = await f.manager.propose({
    ...proposal,
    data: { alias: "<script>alert(1)</script>", sequence: [] },
  });
  const review = new OwnerReview(f.manager),
    server = createServer(async (req, res) => {
      await review.handle(req, res, "/manage");
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/manage?change=${r.id}`;
  const post = (form, extra = {}) =>
    fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: issuer,
        ...extra,
      },
      body: new URLSearchParams(form),
    });
  let response = await fetch(url);
  assert.ok(!(await response.text()).includes("alert(1)"));
  assert.equal(
    (
      await post(
        { password: f.config.approvalPassword },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal((await post({ password: f.config.apiKey })).status, 401);
  response = await post({ password: f.config.approvalPassword });
  assert.equal(response.status, 303);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.match(
    response.headers.get("set-cookie"),
    /Secure; HttpOnly; SameSite=Strict/,
  );
  response = await fetch(url, { headers: { Cookie: cookie } });
  const html = await response.text();
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(
    (await post({ decision: "approve", csrf: "wrong" }, { Cookie: cookie }))
      .status,
    403,
  );
  const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
  assert.equal(
    (await post({ decision: "approve", csrf }, { Cookie: cookie })).status,
    200,
  );
  assert.equal(f.manager.get(r.id).status, "approved");
  assert.equal(f.writes, 0);
});

test("HA transport sends authenticated HTTP and documented WebSocket command shapes", async (t) => {
  const httpCalls = [],
    wsCalls = [];
  const server = createServer((req, res) => {
    httpCalls.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(req.url.includes("missing") ? 404 : 200, {
      "Content-Type": "application/json",
    });
    res.end(
      req.url.includes("missing")
        ? "secret-response"
        : '{"alias":"Read","sequence":[]}',
    );
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "auth_required" }));
    socket.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "auth") {
        assert.equal(m.access_token, "test-token");
        socket.send(JSON.stringify({ type: "auth_ok" }));
      } else {
        wsCalls.push(m);
        socket.send(
          JSON.stringify({
            id: m.id,
            type: "result",
            success: true,
            result: { id: "created" },
          }),
        );
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    wss.close();
    await new Promise((r) => server.close(r));
  });
  const base = `127.0.0.1:${server.address().port}`,
    ha = new HomeAssistantClient(
      `http://${base}/api`,
      `ws://${base}/api/websocket`,
      "test-token",
    ),
    targets = new ChangeTargets(ha);
  await ha.getScript("test");
  assert.equal(httpCalls[0].authorization, "Bearer test-token");
  assert.equal(httpCalls[0].url, "/api/config/script/config/test");
  await assert.rejects(
    ha.getScript("missing"),
    (e) =>
      e instanceof HomeAssistantError &&
      e.code === 404 &&
      !e.message.includes("secret-response"),
  );
  for (const spec of [
    {
      kind: "helper",
      domain: "input_boolean",
      action: "update",
      id: "test",
      data: { name: "Test" },
    },
    { kind: "zone", action: "update", id: "home_zone", data: { radius: 50 } },
    { kind: "device", action: "update", id: "d", data: { area_id: "room" } },
    {
      kind: "blueprint",
      action: "create",
      data: { domain: "automation", path: "user/test.yaml", yaml: "test" },
    },
  ])
    await targets.write(spec);
  assert.equal(wsCalls[0].type, "input_boolean/update");
  assert.equal(wsCalls[0].input_boolean_id, "test");
  assert.equal(wsCalls[1].zone_id, "home_zone");
  assert.equal(wsCalls[2].type, "config/device_registry/update");
  assert.equal(wsCalls[2].device_id, "d");
  assert.equal(wsCalls[3].allow_override, false);
});

test("setup tool catalogue includes all requested names; dashboard edits preserve unrelated content", async (t) => {
  const f = fixture(t);
  const registered = new Map();
  registerSetupTools(
    {
      registerTool: (name, config, fn) => registered.set(name, { config, fn }),
    },
    f.manager,
  );
  for (const name of [
    "preview_configuration_change",
    "validate_configuration_change",
    "apply_approved_change",
    "list_configuration_versions",
    "preview_configuration_restore",
    "get_change_history",
    "get_automation_traces",
    "get_entity_history",
    "get_system_health",
    "get_error_logs",
    "find_entity_references",
    "check_configuration_references",
    "list_helpers",
    "get_helper",
    "propose_helper_change",
    "list_scenes",
    "get_scene",
    "propose_scene_change",
    "create_area",
    "update_area",
    "create_floor",
    "assign_area_to_floor",
    "assign_device_to_area",
    "rename_device",
    "rename_entity",
    "create_helper",
    "update_helper",
    "create_scene",
    "update_scene",
    "set_automation_enabled",
    "list_blueprints",
    "import_blueprint",
    "create_automation_from_blueprint",
    "add_dashboard_view",
    "add_dashboard_card",
    "update_dashboard_card",
    "move_dashboard_card",
    "create_label",
    "assign_label",
    "create_zone",
    "update_zone",
  ])
    assert.ok(registered.has(name), name);
  const original = {
    title: "Keep",
    views: [
      { title: "Living", cards: [{ type: "a" }, { type: "b" }] },
      { type: "sections", sections: [{ cards: [{ type: "c" }] }] },
    ],
  };
  let submitted;
  f.ha.getDashboard = async () => structuredClone(original);
  f.manager.propose = async (spec, before) => {
    submitted = { spec, before };
    return spec;
  };
  const call = async (name, args) =>
    registered
      .get(name)
      .fn(registered.get(name).config.inputSchema.parse(args));
  assert.ok(
    !(
      await call("move_dashboard_card", {
        view_index: 0,
        card_index: 0,
        to_view_index: 1,
        to_section_index: 0,
        to_card_index: 1,
      })
    ).isError,
  );
  assert.deepEqual(submitted.before, original);
  assert.equal(submitted.spec.data.title, "Keep");
  assert.deepEqual(submitted.spec.data.views[0].cards, [{ type: "b" }]);
  assert.deepEqual(submitted.spec.data.views[1].sections[0].cards, [
    { type: "c" },
    { type: "a" },
  ]);
  assert.ok(
    (
      await call("update_dashboard_card", {
        view_index: 0,
        card_index: 9,
        card: { type: "x" },
      })
    ).isError,
  );
  assert.ok(
    (await call("add_dashboard_card", { view_index: 1, card: { type: "x" } }))
      .isError,
  );
  assert.ok(
    (
      await call("get_entity_history", {
        entity_ids: ["light.test"],
        start_time: "2026-01-01T00:00:00Z",
        end_time: "2026-02-01T00:00:00Z",
      })
    ).isError,
  );
  assert.ok(
    (
      await call("import_blueprint", {
        url: "http://localhost/secret",
        path: "user/test.yaml",
      })
    ).isError,
  );
});

test("read-back mismatches are explicit and do not permit retries", async (t) => {
  const f = fixture(t);
  const r = await f.manager.propose(proposal);
  f.manager.approve(r.id, true);
  f.manager.targets.verify = async () => ({
    verified: false,
    snapshot: { alias: "HA normalized it", sequence: [] },
    target: proposal,
  });
  assert.equal((await f.manager.apply(r.id)).status, "applied_unverified");
  assert.equal(f.manager.versions().length, 2);
  await assert.rejects(f.manager.apply(r.id), /already been attempted/);
});

test("create only treats an explicit 404 as absence; auth/network failures never become create permission", async () => {
  const spec = {
    kind: "script",
    action: "create",
    id: "new",
    data: { sequence: [] },
  };
  for (const code of [401, 403, 500]) {
    const targets = new ChangeTargets({
      request: async () => {
        throw new HomeAssistantError("upstream failure", code);
      },
    });
    await assert.rejects(targets.read(spec), /upstream failure/);
  }
  const missing = new ChangeTargets({
    request: async () => {
      throw new HomeAssistantError("missing", 404);
    },
  });
  assert.equal(await missing.read(spec), null);
  const existing = new ChangeTargets({
    request: async () => ({ sequence: [] }),
  });
  await assert.rejects(existing.read(spec), /already exists/);
});

test("entity rename recovery addresses the renamed entity and restores the original id", () => {
  const targets = new ChangeTargets({});
  const restored = targets.restore(
    {
      kind: "entity",
      action: "update",
      id: "light.old",
      data: { new_entity_id: "light.new", name: "New" },
    },
    { entity_id: "light.old", name: "Old", labels: [], platform: "test" },
  );
  assert.equal(restored.id, "light.new");
  assert.equal(restored.data.new_entity_id, "light.old");
  assert.equal(restored.data.name, "Old");
  assert.ok(!("platform" in restored.data));
});

test('blueprint import freezes fetched YAML and rejects unsupported domains before proposing',async t=>{
 const f=fixture(t),tools=new Map();registerSetupTools({registerTool:(n,c,fn)=>tools.set(n,fn)},f.manager);
 const yaml='blueprint:\n  name: Test\n  domain: automation\n';let spec;
 f.ha.websocketCommand=async command=>{assert.equal(command.type,'blueprint/import');return {raw_data:yaml,blueprint:{metadata:{domain:'automation'}},validation_errors:[]};};
 f.manager.propose=async value=>{spec=value;return value;};
 const result=await tools.get('import_blueprint')({url:'https://github.com/example/blueprints/blob/main/test.yaml',path:'user/test.yaml'});
 assert.ok(!result.isError);assert.equal(spec.data.yaml,yaml);assert.equal(spec.action,'create');assert.equal(f.writes,0);
 spec=undefined;f.ha.websocketCommand=async()=>({raw_data:yaml,blueprint:{metadata:{domain:'script'}}});assert.ok((await tools.get('import_blueprint')({url:'https://github.com/example/test',path:'user/test.yaml'})).isError);assert.equal(spec,undefined);
});

test('registry, configuration and automation-enable adapters use the intended HA APIs',async()=>{
 const calls=[];const ha={websocketCommand:async v=>{calls.push(v);return {};},request:async(path,init)=>{calls.push({path,method:init.method,body:JSON.parse(init.body)});return {};}};
 const targets=new ChangeTargets(ha);
 await targets.write({kind:'area',action:'create',data:{name:'Living'}});
 await targets.write({kind:'area',action:'update',id:'living',data:{floor_id:'ground'}});
 await targets.write({kind:'floor',action:'create',data:{name:'Ground',level:0}});
 await targets.write({kind:'label',action:'create',data:{name:'Lights'}});
 await targets.write({kind:'entity',action:'update',id:'light.old',data:{new_entity_id:'light.new'}});
 await targets.write({kind:'scene',action:'create',id:'evening',data:{name:'Evening',entities:{'light.test':'on'}}});
 await targets.write({kind:'automation_enabled',action:'update',id:'automation.test',data:{enabled:false}});
 assert.deepEqual(calls.slice(0,5),[
  {type:'config/area_registry/create',name:'Living'},
  {type:'config/area_registry/update',area_id:'living',floor_id:'ground'},
  {type:'config/floor_registry/create',name:'Ground',level:0},
  {type:'config/label_registry/create',name:'Lights'},
  {type:'config/entity_registry/update',entity_id:'light.old',new_entity_id:'light.new'},
 ]);
 assert.equal(calls[5].path,'/config/scene/config/evening');assert.equal(calls[5].method,'POST');
 assert.deepEqual(calls[6],{path:'/services/automation/turn_off',method:'POST',body:{entity_id:'automation.test',stop_actions:false}});
});

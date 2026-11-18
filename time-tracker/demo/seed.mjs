// FAKE sample data for demo mode. Every name, email and number here is made up.
// It is loaded through the app's own API, the same way a real admin would add it.

export const DEMO_PASSWORD = 'demo-password-123';

const STAFF = [
  { email: 'owner@example.com', display_name: 'Olivia Owner', role: 'admin' },
  { email: 'sam@example.com', display_name: 'Sam Rivera', role: 'manager' },
  { email: 'jo@example.com', display_name: 'Jo Patel', role: 'employee' },
  { email: 'alex@example.com', display_name: 'Alex Kim', role: 'employee' },
];

const CLIENTS = [
  { name: 'Corner Cafe', billing_model: 'hourly', rate_cents: 8500, hours_cap: 25 },
  { name: 'Bright Dental', billing_model: 'monthly_retainer', monthly_retainer_cents: 240000, rate_cents: 9000 },
  { name: 'Green Thumb Landscaping', billing_model: 'hourly', rate_cents: 7500, hours_cap: 15 },
  { name: 'Harbor Yoga Studio', billing_model: 'hourly', rate_cents: 6500, hours_cap: 10 },
];

const TASKS = {
  dept_ads_management: ['Weekly ad check', 'New ad set build', 'Budget review'],
  dept_graphic_design: ['Menu board design', 'Social post graphics', 'Flyer refresh'],
  dept_social_media: ['Schedule posts for the week', 'Reply to comments', 'Content calendar'],
  dept_seo: ['Google Business Profile update', 'Page speed fixes', 'Keyword review'],
  dept_project_manager: ['Client check-in call', 'Monthly report', 'Plan next sprint'],
};

// Small deterministic random generator so every demo start looks the same.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

export async function seedDemo({ call, port }) {
  const base = `http://localhost:${port}`;
  const req = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const h = { 'content-type': 'application/json', 'user-agent': 'demo-seed', ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    const r = await call(new Request(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }));
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
    return data;
  };

  // 1. The first account (the owner) is created with the one-time bootstrap secret.
  const owner = STAFF[0];
  await req('/api/auth/register', {
    method: 'POST', headers: { 'x-bootstrap-secret': 'demo-bootstrap-only' },
    body: { email: owner.email, password: DEMO_PASSWORD, display_name: owner.display_name },
  });
  const { token } = await req('/api/auth/login', { method: 'POST', body: { email: owner.email, password: DEMO_PASSWORD } });

  // 2. The rest of the team.
  const userIds = {};
  for (const s of STAFF.slice(1)) {
    const r = await req('/api/auth/register', {
      method: 'POST', token,
      body: { email: s.email, password: DEMO_PASSWORD, display_name: s.display_name, role: s.role },
    });
    userIds[s.email] = r.user.id;
  }
  const me = await req('/api/me', { token });
  userIds[owner.email] = (me.user || me).id;

  // 3. Clients.
  const clientIds = {};
  for (const c of CLIENTS) {
    const r = await req('/api/clients', { method: 'POST', token, body: c });
    clientIds[c.name] = (r.client || r).id;
  }

  // 4. Who works on which client.
  const team = {
    'Corner Cafe': ['sam@example.com', 'jo@example.com'],
    'Bright Dental': ['sam@example.com', 'alex@example.com'],
    'Green Thumb Landscaping': ['jo@example.com', 'alex@example.com'],
    'Harbor Yoga Studio': ['jo@example.com'],
  };
  for (const [client, emails] of Object.entries(team)) {
    await req('/api/assignments', { method: 'POST', token,
      body: { client_id: clientIds[client], user_ids: emails.map((e) => userIds[e]) } });
  }

  // 5. What each person is paid per hour (shown on the Team page).
  const pay = { 'sam@example.com': 3200, 'jo@example.com': 2600, 'alex@example.com': 2400 };
  for (const [email, cents] of Object.entries(pay)) {
    await req(`/api/admin/users/${userIds[email]}`, { method: 'PATCH', token, body: { cost_rate_cents: cents } });
  }

  // 6. Three weeks of time entries (weekdays only, ending yesterday).
  const rand = rng(42);
  const depts = Object.keys(TASKS);
  const today = new Date();
  let made = 0;
  for (let back = 21; back >= 1; back--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const [client, emails] of Object.entries(team)) {
      for (const email of emails) {
        if (rand() < 0.25) continue;
        const dept = depts[Math.floor(rand() * depts.length)];
        const task = TASKS[dept][Math.floor(rand() * TASKS[dept].length)];
        const hours = Math.round((0.5 + rand() * 3) * 4) / 4;
        await req('/api/time-entries', { method: 'POST', token, body: {
          client_id: clientIds[client], user_id: userIds[email], entry_date: isoDate(d),
          hours, notes: task, department_id: dept, is_billable: rand() > 0.1,
        } });
        made++;
      }
    }
  }
  console.log(`Demo data loaded: ${STAFF.length} people, ${CLIENTS.length} clients, ${made} time entries (all fake).`);
  return STAFF.map((s) => ({ ...s, password: DEMO_PASSWORD }));
}

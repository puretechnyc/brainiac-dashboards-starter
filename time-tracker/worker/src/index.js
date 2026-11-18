import { json, err, corsHeaders, withSecurityHeaders, SECURITY_HEADERS } from "./util.js";
import {
  authenticate,
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
  isAdmin,
  timingSafeEqual,
  revokeAllSessions,
  tableExists,
  recentLoginFailures,
  recordLoginAttempt,
  LOGIN_MAX_FAILS,
  validatePassword
} from "./auth.js";
import { uuid, readJson } from "./util.js";
import { sendVerificationEmail } from "./email.js";
import { googleAvailable, googleStart, googleCallback } from "./googleAuth.js";
function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "";
}
import { listProjects, createProject, updateProject } from "./handlers/projects.js";
import { listDepartments, createDepartment, updateDepartment } from "./handlers/departments.js";
import { getLockSchedule, putLockSchedule, runLockSchedule } from "./handlers/lock-schedule.js";
import { listClients, getClient, createClient, updateClient, setClientBilling, getClientBilling } from "./handlers/clients.js";
import { listMilestones, createMilestone, updateMilestone, deleteMilestone } from "./handlers/fixed-project.js";
import {
  createEntry,
  listEntries,
  updateEntry,
  deleteEntry,
  submitEntry,
  reviewEntry,
  listEntryEdits
} from "./handlers/timeEntries.js";
import { clientReport, summaryReport, exportCsv, staffReport } from "./handlers/reports.js";
import {
  generateInvoice,
  listInvoices,
  getInvoice,
  updateInvoice,
  addLineItem,
  removeLineItem,
  updateInvoiceStatus,
  voidInvoice,
  recordPayment,
  sendInvoice,
  invoiceHtml,
  paypalInvoice,
  exportInvoiceCsv
} from "./handlers/invoices.js";
import {
  listTimesheets,
  getTimesheet,
  submitTimesheet,
  approveTimesheet
} from "./handlers/timesheets.js";
import { startTimer, stopTimer, currentTimer } from "./handlers/timer.js";
import { meSummary } from "./handlers/dashboard.js";
import { applyMigration015, applyMigration016, applyMigration017, applyMigration018, applyMigration019, applyMigration020, applyMigration021, applyMigration022, applyMigration025, applyMigration026, applyMigration030, applyMigration031, applyMigration032, applyMigration036, listClientSlugs, setClientSlugs, listUsers, updateUser, resetPassword, forceLogout, lockBefore, bulkImport } from "./handlers/admin.js";
import { weeklyOverview, setWeeklyGoal, teamWeekly } from "./handlers/weekly.js";
import { createFeedback, listFeedback, updateFeedback } from "./handlers/feedback.js";
import { listNotifications, markRead, markAllRead } from "./handlers/notifications.js";
import {
  integrationAuth,
  isServiceToken,
  integrationHealth,
  listIntegrationClients,
  getIntegrationClient,
  listIntegrationAssignments
} from "./handlers/integration.js";
import { listAssignments, setAssignments, setClientTeam } from "./handlers/assignments.js";
import { listWorkRequests, createWorkRequest, decideWorkRequest, myWorkRequests } from "./handlers/workRequests.js";
import {
  myHourBudget,
  requestHourBudget,
  listHourBudgetRequests,
  decideHourBudgetRequest,
  hourBudgetOverview,
  setHourBudget
} from "./handlers/hourBudget.js";
import { clientDashboard, clientActivity, clientHoursSummary } from "./handlers/clientPortal.js";
import {
  weeklyBudgetAll,
  weeklyBudgetDetail,
  underTarget,
  clientWeights,
  setClientWeights,
  memberWeights,
  setMemberWeights,
  clientBudgetHistory,
  progressTab,
  checkUnderTargetAlerts
} from "./handlers/budget.js";
import {
  clientUpdates,
  clientUpdateWeeks,
  adminGoalsUpdates,
  goalsSync
} from "./handlers/goalsPortal.js";
import { goalsIntegrationSync, isGoalsWriteToken } from "./handlers/goalsWrite.js";
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkUnderTargetAlerts(env));
    ctx.waitUntil(runLockSchedule(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(request) } });
    }
    if (pathname === "/health") return json(request, { ok: true, service: "time-tracker", phase: 1 });
    try {
      if (pathname === "/api/auth/register" && method === "POST") return await register(request, env);
      if (pathname === "/api/auth/login" && method === "POST") return await login(request, env);
      if (pathname === "/api/auth/verify" && (method === "POST" || method === "GET")) {
        return await verifyEmail(request, env, url);
      }
      if (pathname === "/api/auth/google/available" && method === "GET") return googleAvailable(request, env);
      if (pathname === "/api/auth/google/start" && method === "GET") return await googleStart(request, env);
      if (pathname === "/api/auth/google/callback" && method === "GET") return await googleCallback(request, env, url);
      if (pathname === "/api/integration/goals/sync") {
        return await goalsIntegrationSync(request, env);
      }
      if (pathname.startsWith("/api/integration/")) {
        if (await isGoalsWriteToken(request, env)) {
          return err(request, "the write token cannot be used on integration read routes", 401);
        }
        const auth = await integrationAuth(request, env);
        if (!auth.ok) return err(request, auth.message, auth.status, auth.code);
        let im;
        if (pathname === "/api/integration/health") {
          if (method !== "GET") return err(request, "method not allowed", 405);
          return await integrationHealth(request, env);
        }
        if (pathname === "/api/integration/clients") {
          if (method !== "GET") return err(request, "method not allowed", 405);
          return await listIntegrationClients(request, env);
        }
        if (pathname === "/api/integration/assignments") {
          if (method !== "GET") return err(request, "method not allowed", 405);
          return await listIntegrationAssignments(request, env);
        }
        if (im = pathname.match(/^\/api\/integration\/client\/([^/]+)$/)) {
          if (method !== "GET") return err(request, "method not allowed", 405);
          return await getIntegrationClient(request, env, decodeURIComponent(im[1]), url);
        }
        return err(request, "not found", 404);
      }
      if (pathname.startsWith("/api/")) {
        if (await isServiceToken(request, env)) {
          return err(request, "the service token cannot be used on user routes", 401);
        }
        if (await isGoalsWriteToken(request, env)) {
          return err(request, "the write token cannot be used on user routes", 401);
        }
        const principal = await authenticate(env, request);
        if (!principal) return err(request, "unauthorized", 401);
        if (pathname === "/api/auth/logout" && method === "POST") {
          await destroySession(env, request);
          return json(request, { ok: true });
        }
        if (pathname === "/api/me" && method === "GET") {
          return json(request, { ok: true, user: principal });
        }
        if (pathname === "/api/me/summary" && method === "GET") {
          return await meSummary(request, env, principal);
        }
        if (pathname === "/api/auth/change-password" && method === "POST") {
          return await changePassword(request, env, principal);
        }
        if (pathname === "/api/client/dashboard" && method === "GET") {
          return await clientDashboard(request, env, principal);
        }
        if (pathname === "/api/client/activity" && method === "GET") {
          return await clientActivity(request, env, principal, url);
        }
        if (pathname === "/api/client/hours-summary" && method === "GET") {
          return await clientHoursSummary(request, env, principal);
        }
        if (pathname === "/api/client/budget-history" && method === "GET") {
          return await clientBudgetHistory(request, env, principal);
        }
        if (pathname === "/api/client/updates" && method === "GET") {
          return await clientUpdates(request, env, principal, url);
        }
        if (pathname === "/api/client/updates/weeks" && method === "GET") {
          return await clientUpdateWeeks(request, env, principal);
        }
        if (pathname === "/api/budget/weekly" && method === "GET") {
          return await weeklyBudgetAll(request, env, principal);
        }
        if (pathname === "/api/progress" && method === "GET") return await progressTab(request, env, principal);
        if (pathname === "/api/budget/under-target" && method === "GET") {
          return await underTarget(request, env, principal);
        }
        if (pathname === "/api/timer/start" && method === "POST") return await startTimer(request, env, principal);
        if (pathname === "/api/timer/stop" && method === "POST") return await stopTimer(request, env, principal);
        if (pathname === "/api/timer/current" && method === "GET") return await currentTimer(request, env, principal);
        let m;
        if ((m = pathname.match(/^\/api\/budget\/weekly\/([^/]+)$/)) && method === "GET") {
          return await weeklyBudgetDetail(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/clients\/([^/]+)\/weights$/)) && method === "GET") {
          return await clientWeights(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/clients\/([^/]+)\/weights$/)) && method === "PUT") {
          return await setClientWeights(request, env, principal, m[1]);
        }
        if (pathname === "/api/member-weights" && method === "GET") return await memberWeights(request, env, principal);
        if (pathname === "/api/member-weights" && method === "PUT") return await setMemberWeights(request, env, principal);
        if (pathname === "/api/notifications" && method === "GET") return await listNotifications(request, env, principal);
        if ((m = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/)) && method === "PATCH") {
          return await markRead(request, env, principal, m[1]);
        }
        if (pathname === "/api/notifications/read-all" && method === "POST") {
          return await markAllRead(request, env, principal);
        }
        if (pathname === "/api/assignments" && method === "GET") return await listAssignments(request, env, principal);
        if (pathname === "/api/assignments" && method === "POST") return await setAssignments(request, env, principal);
        if (pathname === "/api/work-requests" && method === "GET") return await listWorkRequests(request, env, principal);
        if (pathname === "/api/work-requests" && method === "POST") return await createWorkRequest(request, env, principal);
        if (pathname === "/api/work-requests/mine" && method === "GET") return await myWorkRequests(request, env, principal);
        if ((m = pathname.match(/^\/api\/work-requests\/([^/]+)\/decision$/)) && method === "POST") {
          return await decideWorkRequest(request, env, principal, m[1]);
        }
        if (pathname === "/api/hour-budget/me" && method === "GET") {
          return await myHourBudget(request, env, principal, url);
        }
        if (pathname === "/api/hour-budget/request" && method === "POST") {
          return await requestHourBudget(request, env, principal);
        }
        if (pathname === "/api/hour-budget/requests" && method === "GET") {
          return await listHourBudgetRequests(request, env, principal, url);
        }
        if ((m = pathname.match(/^\/api\/hour-budget\/requests\/([^/]+)\/decision$/)) && method === "POST") {
          return await decideHourBudgetRequest(request, env, principal, m[1]);
        }
        if (pathname === "/api/hour-budget/overview" && method === "GET") {
          return await hourBudgetOverview(request, env, principal, url);
        }
        if (pathname === "/api/hour-budget/budget" && method === "POST") {
          return await setHourBudget(request, env, principal);
        }
        if (pathname === "/api/admin/apply-migration-015" && method === "POST") return await applyMigration015(request, env, principal);
        if (pathname === "/api/admin/apply-migration-016" && method === "POST") return await applyMigration016(request, env, principal);
        if (pathname === "/api/admin/apply-migration-017" && method === "POST") return await applyMigration017(request, env, principal);
        if (pathname === "/api/admin/apply-migration-018" && method === "POST") return await applyMigration018(request, env, principal);
        if (pathname === "/api/admin/apply-migration-019" && method === "POST") return await applyMigration019(request, env, principal);
        if (pathname === "/api/admin/apply-migration-020" && method === "POST") return await applyMigration020(request, env, principal);
        if (pathname === "/api/admin/apply-migration-021" && method === "POST") return await applyMigration021(request, env, principal);
        if (pathname === "/api/admin/apply-migration-022" && method === "POST") return await applyMigration022(request, env, principal);
        if (pathname === "/api/admin/apply-migration-025" && method === "POST") return await applyMigration025(request, env, principal);
        if (pathname === "/api/admin/apply-migration-026" && method === "POST") return await applyMigration026(request, env, principal);
        if (pathname === "/api/admin/apply-migration-030" && method === "POST") return await applyMigration030(request, env, principal);
        if (pathname === "/api/admin/apply-migration-031" && method === "POST") return await applyMigration031(request, env, principal);
        if (pathname === "/api/admin/apply-migration-032" && method === "POST") return await applyMigration032(request, env, principal);
        if (pathname === "/api/admin/apply-migration-036" && method === "POST") return await applyMigration036(request, env, principal);
        if (pathname === "/api/admin/weekly" && method === "GET") return await weeklyOverview(request, env, principal, url);
        if (pathname === "/api/team/weekly" && method === "GET") return await teamWeekly(request, env, principal, url);
        if (pathname === "/api/admin/weekly/goal" && method === "POST") return await setWeeklyGoal(request, env, principal);
        if (pathname === "/api/admin/clients/slugs" && method === "GET") return await listClientSlugs(request, env, principal);
        if (pathname === "/api/admin/clients/slugs" && method === "POST") return await setClientSlugs(request, env, principal);
        if (pathname === "/api/admin/users" && method === "GET") return await listUsers(request, env, principal);
        if ((m = pathname.match(/^\/api\/admin\/users\/([^/]+)$/)) && method === "PATCH") {
          return await updateUser(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/)) && method === "POST") {
          return await resetPassword(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/admin\/users\/([^/]+)\/sessions$/)) && method === "DELETE") {
          return await forceLogout(request, env, principal, m[1]);
        }
        if (pathname === "/api/admin/lock-before" && method === "POST") return await lockBefore(request, env, principal);
        if (pathname === "/api/admin/lock-schedule" && method === "GET") return await getLockSchedule(request, env, principal);
        if (pathname === "/api/admin/lock-schedule" && method === "PUT") return await putLockSchedule(request, env, principal);
        if (pathname === "/api/admin/bulk-import" && method === "POST") return await bulkImport(request, env, principal);
        if (pathname === "/api/goals/updates" && method === "GET") return await adminGoalsUpdates(request, env, principal, url);
        if (pathname === "/api/goals/sync" && method === "POST") return await goalsSync(request, env, principal);
        if (pathname === "/api/projects" && method === "GET") return await listProjects(request, env, principal, url);
        if (pathname === "/api/projects" && method === "POST") return await createProject(request, env, principal);
        if ((m = pathname.match(/^\/api\/projects\/([^/]+)$/)) && method === "PATCH") {
          return await updateProject(request, env, principal, m[1]);
        }
        if (pathname === "/api/departments" && method === "GET") return await listDepartments(request, env, principal, url);
        if (pathname === "/api/departments" && method === "POST") return await createDepartment(request, env, principal);
        if ((m = pathname.match(/^\/api\/departments\/([^/]+)$/)) && method === "PATCH") {
          return await updateDepartment(request, env, principal, m[1]);
        }
        if (pathname === "/api/clients" && method === "GET") return await listClients(request, env, principal, url);
        if (pathname === "/api/clients" && method === "POST") return await createClient(request, env, principal);
        if (m = pathname.match(/^\/api\/clients\/([^/]+)$/)) {
          if (method === "GET") return await getClient(request, env, principal, m[1]);
          if (method === "PATCH") return await updateClient(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/clients\/([^/]+)\/team$/)) && method === "PUT") {
          return await setClientTeam(request, env, principal, m[1]);
        }
        if (m = pathname.match(/^\/api\/clients\/([^/]+)\/billing$/)) {
          if (method === "GET") return await getClientBilling(request, env, principal, m[1]);
          if (method === "PUT") return await setClientBilling(request, env, principal, m[1]);
        }
        if (m = pathname.match(/^\/api\/clients\/([^/]+)\/milestones\/([^/]+)$/)) {
          if (method === "PATCH") return await updateMilestone(request, env, principal, m[1], m[2]);
          if (method === "DELETE") return await deleteMilestone(request, env, principal, m[1], m[2]);
        }
        if (m = pathname.match(/^\/api\/clients\/([^/]+)\/milestones$/)) {
          if (method === "GET") return await listMilestones(request, env, principal, m[1]);
          if (method === "POST") return await createMilestone(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/clients\/([^/]+)\/report$/)) && method === "GET") {
          return await clientReport(request, env, principal, m[1], url);
        }
        if (pathname === "/api/reports/summary" && method === "GET") {
          return await summaryReport(request, env, principal, url);
        }
        if (pathname === "/api/reports/export" && method === "GET") {
          return await exportCsv(request, env, principal, url);
        }
        if (pathname === "/api/reports/staff" && method === "GET") {
          return await staffReport(request, env, principal, url);
        }
        if (pathname === "/api/feedback" && method === "POST") return await createFeedback(request, env, principal);
        if (pathname === "/api/feedback" && method === "GET") return await listFeedback(request, env, principal, url);
        if ((m = pathname.match(/^\/api\/feedback\/([^/]+)$/)) && method === "PATCH") {
          return await updateFeedback(request, env, principal, m[1]);
        }
        if (pathname === "/api/time-entries" && method === "GET") return await listEntries(request, env, principal, url);
        if (pathname === "/api/time-entries" && method === "POST") return await createEntry(request, env, principal);
        if (m = pathname.match(/^\/api\/time-entries\/([^/]+)$/)) {
          if (method === "PATCH") return await updateEntry(request, env, principal, m[1]);
          if (method === "DELETE") return await deleteEntry(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/time-entries\/([^/]+)\/submit$/)) && method === "POST") {
          return await submitEntry(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/time-entries\/([^/]+)\/review$/)) && method === "POST") {
          return await reviewEntry(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/time-entries\/([^/]+)\/edits$/)) && method === "GET") {
          return await listEntryEdits(request, env, principal, m[1]);
        }
        if (pathname === "/api/timesheets" && method === "GET") return await listTimesheets(request, env, principal, url);
        if ((m = pathname.match(/^\/api\/timesheets\/([^/]+)\/submit$/)) && method === "POST") {
          return await submitTimesheet(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/timesheets\/([^/]+)\/approve$/)) && method === "POST") {
          return await approveTimesheet(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/timesheets\/([^/]+)$/)) && method === "GET") {
          return await getTimesheet(request, env, principal, m[1]);
        }
        if (pathname === "/api/invoices" && method === "GET") return await listInvoices(request, env, principal, url);
        if (pathname === "/api/invoices" && method === "POST") return await generateInvoice(request, env, principal);
        if (m = pathname.match(/^\/api\/invoices\/([^/]+)$/)) {
          if (method === "GET") return await getInvoice(request, env, principal, m[1]);
          if (method === "PATCH") return await updateInvoice(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/html$/)) && method === "GET") {
          return await invoiceHtml(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/line-items$/)) && method === "POST") {
          return await addLineItem(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/line-items\/([^/]+)$/)) && method === "DELETE") {
          return await removeLineItem(request, env, principal, m[1], m[2]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/status$/)) && method === "PATCH") {
          return await updateInvoiceStatus(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/void$/)) && method === "POST") {
          return await voidInvoice(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/payments$/)) && method === "POST") {
          return await recordPayment(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/send$/)) && method === "POST") {
          return await sendInvoice(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/paypal$/)) && method === "POST") {
          return await paypalInvoice(request, env, principal, m[1]);
        }
        if ((m = pathname.match(/^\/api\/invoices\/([^/]+)\/export$/)) && method === "GET") {
          return await exportInvoiceCsv(request, env, principal, m[1]);
        }
        return err(request, "not found", 404);
      }
      if (env.ASSETS) return withSecurityHeaders(await env.ASSETS.fetch(request));
      return err(request, "not found", 404);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error("Unhandled error:", e);
      return err(request, status >= 500 ? "internal error" : e.message || "internal error", status);
    }
  }
};
async function register(request, env) {
  const b = await readJson(request);
  const email = (b.email || "").trim().toLowerCase();
  const password = b.password || "";
  if (!email || !password) return err(request, "email and password required", 422);
  const pol = await validatePassword(password);
  if (!pol.ok) return err(request, pol.reason, 422);
  if (pol.hibpError) console.log("HIBP check failed-open during register (network error)");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  const isBootstrap = (count?.n || 0) === 0;
  let role = "admin";
  let clientId = null;
  let wantsManager = false;
  let actorId = null;
  if (isBootstrap) {
    const secret = env.BOOTSTRAP_SECRET || "";
    const provided = request.headers.get("X-Bootstrap-Secret") || "";
    if (!secret || !provided || !await timingSafeEqual(provided, secret)) {
      return err(request, "bootstrap not permitted", 403);
    }
  } else {
    const principal = await authenticate(env, request);
    if (!principal || !isAdmin(principal)) {
      return err(request, "registration closed — an admin must create users", 403);
    }
    actorId = principal.userId;
    const wanted = String(b.role || "employee").trim().toLowerCase();
    if (!["admin", "employee", "client", "manager"].includes(wanted)) {
      return err(request, "role must be one of admin, manager, employee, client", 422);
    }
    wantsManager = wanted === "manager";
    role = wantsManager ? "employee" : wanted;
    if (role === "client") {
      if (!b.client_id) return err(request, "client role requires client_id", 422);
      const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(b.client_id).first();
      if (!c) return err(request, "client_id not found", 404);
      clientId = b.client_id;
    }
    if (wantsManager && !await tableExists(env, "staff_roles")) {
      return err(
        request,
        "staff roles need database migration 019 (POST /api/admin/apply-migration-019) — nothing was created",
        409,
        "migration_required"
      );
    }
  }
  const { hash, salt, iters } = await hashPassword(password);
  const id = uuid();
  const autoVerified = role === "admin";
  const verifyToken = autoVerified ? null : uuid();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id,email,display_name,password_hash,password_salt,pbkdf2_iters,role,client_id,email_verified,email_verify_token)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,
      email,
      b.display_name || "",
      hash,
      salt,
      iters,
      role,
      clientId,
      autoVerified ? 1 : 0,
      verifyToken
    ).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) return err(request, "That email already has an account. Use Reset password on the Team tab to set a new password.", 409, "email_exists");
    throw e;
  }
  if (wantsManager) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO staff_roles (user_id, role, granted_by) VALUES (?, 'manager', ?)`
    ).bind(id, actorId).run();
  }
  if (!autoVerified && verifyToken) {
    try {
      await sendVerificationEmail(env, { to: email, token: verifyToken, displayName: b.display_name });
    } catch (_) {
    }
  }
  const { token, expires } = await createSession(env, id);
  return json(request, {
    ok: true,
    token,
    expires,
    user: {
      id,
      email,
      role,
      client_id: clientId,
      email_verified: autoVerified ? 1 : 0,
      roles: wantsManager ? ["manager"] : [],
      effective_role: wantsManager ? "manager" : role
    }
  }, 201);
}
async function login(request, env) {
  const b = await readJson(request);
  const email = (b.email || "").trim().toLowerCase();
  const password = b.password || "";
  if (!email || !password) return err(request, "email and password required", 422);
  const ip = clientIp(request);
  const { emailFails, ipFails } = await recentLoginFailures(env, { email, ip });
  if (emailFails >= LOGIN_MAX_FAILS || ipFails >= LOGIN_MAX_FAILS) {
    return err(request, "too many failed attempts — try again later", 429, "locked_out");
  }
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const ok = u ? await verifyPassword(password, u.password_hash, u.password_salt, u.pbkdf2_iters) : false;
  if (!u || !ok) {
    await recordLoginAttempt(env, { email, ip, success: false });
    return err(request, "invalid credentials", 401);
  }
  if (u.active === 0) {
    return err(request, "account deactivated — contact an administrator", 403, "deactivated");
  }
  await recordLoginAttempt(env, { email, ip, success: true });
  const { token, expires } = await createSession(env, u.id);
  return json(request, {
    ok: true,
    token,
    expires,
    user: {
      id: u.id,
      email: u.email,
      role: u.role,
      client_id: u.client_id,
      display_name: u.display_name,
      email_verified: u.email_verified
    }
  });
}
async function changePassword(request, env, principal) {
  const b = await readJson(request);
  const current = b.current_password || "";
  const next = b.new_password || "";
  if (!current || !next) return err(request, "current_password and new_password required", 422);
  const pol = await validatePassword(next);
  if (!pol.ok) return err(request, pol.reason, 422);
  if (pol.hibpError) console.log("HIBP check failed-open during change-password (network error)");
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(principal.userId).first();
  if (!u) return err(request, "not found", 404);
  const ok = await verifyPassword(current, u.password_hash, u.password_salt, u.pbkdf2_iters);
  if (!ok) return err(request, "current password is incorrect", 403);
  const { hash, salt, iters } = await hashPassword(next);
  await env.DB.prepare(
    `UPDATE users SET password_hash=?, password_salt=?, pbkdf2_iters=?, updated_at=datetime('now')
      WHERE id=?`
  ).bind(hash, salt, iters, u.id).run();
  await revokeAllSessions(env, u.id);
  const { token, expires } = await createSession(env, u.id);
  return json(request, { ok: true, token, expires, rotated: true });
}
async function verifyEmail(request, env, url) {
  let token = url.searchParams.get("token") || "";
  if (!token && request.method === "POST") {
    const b = await readJson(request);
    token = b.token || "";
  }
  if (!token) return err(request, "token required", 422);
  const u = await env.DB.prepare("SELECT id FROM users WHERE email_verify_token = ?").bind(token).first();
  if (!u) return err(request, "invalid or already-used token", 404);
  await env.DB.prepare(
    `UPDATE users SET email_verified=1, email_verify_token=NULL, updated_at=datetime('now') WHERE id=?`
  ).bind(u.id).run();
  return json(request, { ok: true, verified: true });
}

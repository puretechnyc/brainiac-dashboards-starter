import { json, err, uuid } from "../util.js";
export async function listNotifications(request, env, p) {
  const rows = (await env.DB.prepare(
    `SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY read ASC, created_at DESC
      LIMIT 50`
  ).bind(p.userId).all()).results || [];
  const unreadCount = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0"
  ).bind(p.userId).first())?.n || 0;
  return json(request, { ok: true, notifications: rows, unread_count: unreadCount });
}
export async function markAllRead(request, env, p) {
  const result = await env.DB.prepare(
    "UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0"
  ).bind(p.userId).run();
  const unreadCount = (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0"
  ).bind(p.userId).first())?.n || 0;
  return json(request, {
    ok: true,
    marked: result.meta?.changes || 0,
    unread_count: unreadCount
  });
}
export async function markRead(request, env, p, id) {
  const row = await env.DB.prepare(
    "SELECT * FROM notifications WHERE id = ? AND user_id = ?"
  ).bind(id, p.userId).first();
  if (!row) return err(request, "not found", 404);
  await env.DB.prepare(
    "UPDATE notifications SET read = 1 WHERE id = ?"
  ).bind(id).run();
  return json(request, { ok: true, id, read: true });
}
export async function createNotification(env, userId, type, message) {
  try {
    const id = uuid();
    await env.DB.prepare(
      "INSERT INTO notifications (id, user_id, type, message) VALUES (?, ?, ?, ?)"
    ).bind(id, userId, type, message).run();
    return id;
  } catch (_) {
    return null;
  }
}
export async function notifyAllAdmins(env, type, message) {
  try {
    const admins = (await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND active = 1"
    ).all()).results || [];
    for (const admin of admins) {
      await createNotification(env, admin.id, type, message);
    }
  } catch (_) {
  }
}

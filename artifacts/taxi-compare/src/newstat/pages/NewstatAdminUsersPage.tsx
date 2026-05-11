import { useEffect, useState, type FormEvent } from "react";
import { NewstatLayout } from "../components/NewstatLayout";
import { useNewstatUser } from "../lib/auth-store";
import {
  newstatApi,
  type AdminUser,
  type AdminUserCreateBody,
  type AdminUserUpdateBody,
} from "../lib/api";

const ROLE_RU: Record<AdminUser["role"], string> = {
  admin: "админ",
  antifraud: "антифрод",
  viewer: "просмотр",
};

function fmtDt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NewstatAdminUsersPage() {
  const { user: me, loading: meLoading } = useNewstatUser();
  const isAdmin = me?.role === "admin";

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Модалки / уведомления
  const [showCreate, setShowCreate] = useState(false);
  const [shownPwd, setShownPwd] = useState<{ login: string; password: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function reload() {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const r = await newstatApi.adminUsersList();
    if (r.ok) setUsers(r.data.users);
    else setErr(r.error || "load_failed");
    setLoading(false);
  }

  useEffect(() => {
    if (meLoading) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meLoading, isAdmin]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }

  async function handleUpdate(id: string, patch: AdminUserUpdateBody) {
    setBusyId(id);
    const r = await newstatApi.adminUserUpdate(id, patch);
    setBusyId(null);
    if (!r.ok) {
      flash(`Ошибка: ${r.error}`);
      return;
    }
    flash("Сохранено");
    await reload();
  }

  async function handleDelete(u: AdminUser) {
    if (!confirm(`Удалить сотрудника ${u.login}?`)) return;
    setBusyId(u.id);
    const r = await newstatApi.adminUserDelete(u.id);
    setBusyId(null);
    if (!r.ok) {
      flash(r.error === "cannot_delete_self" ? "Нельзя удалить себя" : `Ошибка: ${r.error}`);
      return;
    }
    flash("Удалено");
    await reload();
  }

  async function handleResetPassword(u: AdminUser) {
    if (!confirm(`Сгенерировать новый пароль для ${u.login}?`)) return;
    setBusyId(u.id);
    const r = await newstatApi.adminUserResetPassword(u.id);
    setBusyId(null);
    if (!r.ok) {
      flash(`Ошибка: ${r.error}`);
      return;
    }
    if (r.data.generated_password) {
      setShownPwd({ login: u.login, password: r.data.generated_password });
    } else {
      flash("Пароль обновлён");
    }
  }

  // ── Рендеринг ────────────────────────────────────────────────────────
  if (meLoading) {
    return (
      <NewstatLayout title="Сотрудники">
        <div className="text-sm text-slate-500">Загрузка профиля…</div>
      </NewstatLayout>
    );
  }
  if (!isAdmin) {
    return (
      <NewstatLayout title="Сотрудники">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          Раздел сотрудников доступен только администраторам.
        </div>
      </NewstatLayout>
    );
  }

  return (
    <NewstatLayout title="Сотрудники">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="text-sm text-slate-600">
          Всего: <span className="font-medium tabular-nums">{users.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm hover:bg-slate-700"
        >
          + Добавить сотрудника
        </button>
      </div>

      {err && (
        <div className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          Ошибка: {err}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Логин</th>
              <th className="px-3 py-2 text-left">Имя</th>
              <th className="px-3 py-2 text-left">Роль</th>
              <th className="px-3 py-2 text-left">Статус</th>
              <th className="px-3 py-2 text-left">Создан</th>
              <th className="px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400 italic">
                  Сотрудников нет
                </td>
              </tr>
            )}
            {users.map((u) => {
              const isMe = u.id === me?.id;
              const busy = busyId === u.id;
              return (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    {u.login}
                    {isMe && <span className="ml-2 text-[10px] text-slate-400">(вы)</span>}
                  </td>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2">
                    <select
                      value={u.role}
                      disabled={busy || isMe}
                      onChange={(e) => handleUpdate(u.id, { role: e.target.value as AdminUser["role"] })}
                      className="border rounded px-1.5 py-1 text-xs disabled:opacity-50"
                      title={isMe ? "Нельзя менять собственную роль" : ""}
                    >
                      <option value="admin">админ</option>
                      <option value="antifraud">антифрод</option>
                      <option value="viewer">просмотр</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {u.active ? (
                      <span className="text-xs text-emerald-700">активен</span>
                    ) : (
                      <span className="text-xs text-slate-400">отключён</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{fmtDt(u.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1 justify-end">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleResetPassword(u)}
                        className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Новый пароль
                      </button>
                      <button
                        type="button"
                        disabled={busy || isMe}
                        onClick={() => handleUpdate(u.id, { active: !u.active })}
                        className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                        title={isMe ? "Нельзя отключить самого себя" : ""}
                      >
                        {u.active ? "Отключить" : "Включить"}
                      </button>
                      <button
                        type="button"
                        disabled={busy || isMe}
                        onClick={() => handleDelete(u)}
                        className="px-2 py-1 text-xs rounded text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        title={isMe ? "Нельзя удалить себя" : ""}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Роль <b>админ</b> — может управлять сотрудниками и настройками. <b>Антифрод</b> —
        только разбор кейсов и тикетов. <b>Просмотр</b> — только чтение.
      </p>

      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={(login, password) => {
            setShowCreate(false);
            void reload();
            if (password) setShownPwd({ login, password });
            else flash("Сотрудник создан");
          }}
        />
      )}

      {shownPwd && (
        <PasswordDialog
          login={shownPwd.login}
          password={shownPwd.password}
          onClose={() => setShownPwd(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-slate-900 text-white text-sm rounded px-3 py-2 shadow-lg">
          {toast}
        </div>
      )}
    </NewstatLayout>
  );
}

// ── Подкомпоненты ──────────────────────────────────────────────────────

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (login: string, generatedPassword: string | null) => void;
}) {
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("antifraud");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!login.trim()) return;
    setBusy(true);
    setErr(null);
    const body: AdminUserCreateBody = {
      login: login.trim(),
      name: name.trim() || login.trim(),
      role,
    };
    const r = await newstatApi.adminUserCreate(body);
    setBusy(false);
    if (!r.ok) {
      setErr(
        r.error === "login_taken"
          ? "Логин уже занят"
          : r.error === "validation_error"
            ? "Некорректные поля (логин 2-64 символа)"
            : `Ошибка: ${r.error}`,
      );
      return;
    }
    onCreated(r.data.user.login, r.data.generated_password ?? null);
  }

  return (
    <div
      className="fixed inset-0 z-[2001] bg-black/40 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
        <div className="text-lg font-semibold mb-3">Новый сотрудник</div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Логин</label>
            <input
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="например, ivanov"
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
            <div className="text-[11px] text-slate-400 mt-0.5">2–64 символа</div>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Имя в интерфейсе</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иванов И.И."
              className="w-full border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Роль</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AdminUser["role"])}
              className="w-full border rounded px-2 py-1.5 text-sm"
            >
              <option value="antifraud">{ROLE_RU.antifraud}</option>
              <option value="admin">{ROLE_RU.admin}</option>
              <option value="viewer">{ROLE_RU.viewer}</option>
            </select>
          </div>
          <p className="text-xs text-slate-500">
            Пароль сгенерируется автоматически и будет показан один раз.
          </p>
          {err && <div className="text-sm text-rose-700">{err}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded text-slate-600 hover:bg-slate-100"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={busy || !login.trim()}
              className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? "Создаю…" : "Создать"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PasswordDialog({
  login,
  password,
  onClose,
}: {
  login: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[2001] bg-black/40 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
        <div className="text-lg font-semibold mb-3">Пароль сотрудника</div>
        <p className="text-sm text-slate-700 mb-3">
          Передайте сотруднику <b>{login}</b> следующие данные. Пароль больше не
          будет показан — сохраните его сейчас.
        </p>
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-base select-all break-all">
          {password}
        </div>
        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(password);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-100"
          >
            {copied ? "Скопировано" : "Скопировать"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-700"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

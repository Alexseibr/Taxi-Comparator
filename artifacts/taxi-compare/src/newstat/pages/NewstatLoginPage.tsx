import { useState } from "react";
import { useLocation } from "wouter";
import { NewstatLayout } from "../components/NewstatLayout";
import { newstatApi, setToken } from "../lib/api";

export function NewstatLoginPage() {
  const [, navigate] = useLocation();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const r = await newstatApi.login(login.trim(), password);
    setBusy(false);
    if (!r.ok) {
      setErr(
        r.error === "invalid_credentials"
          ? "Неверный логин или пароль"
          : `Ошибка: ${r.error}`,
      );
      return;
    }
    setToken(r.data.token);
    navigate("/newstat", { replace: true });
  }

  return (
    <NewstatLayout title="Вход в Newstat" publicAccess>
      <form
        onSubmit={submit}
        className="max-w-sm bg-white border border-slate-200 rounded-lg p-6 space-y-4"
      >
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
            Логин
          </label>
          <input
            type="text"
            autoFocus
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
            Пароль
          </label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            required
          />
        </div>
        {err && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-slate-900 text-white rounded py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? "Входим…" : "Войти"}
        </button>
        <p className="text-xs text-slate-400">
          Newstat использует собственную учётную запись, отдельную от старого модуля /wb.
        </p>
      </form>
    </NewstatLayout>
  );
}

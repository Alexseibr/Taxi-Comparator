import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { WbShell } from "@/components/wb/WbShell";
import {
  createWbUser, deleteWbUser, fetchWbUsers, updateWbUser,
  type WbRole, type WbUser,
} from "@/lib/wb-api";
import { useWbCurrentUser } from "@/lib/wb-auth";
import { roleLabel } from "@/lib/module-access";

function fmtDt(ms?: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function WbAdminUsersPage() {
  const me = useWbCurrentUser();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [createLogin, setCreateLogin] = useState("");
  const [createName, setCreateName] = useState("");
  const [createRole, setCreateRole] = useState<WbRole>("viewer");

  const [shownPassword, setShownPassword] = useState<{ login: string; password: string } | null>(null);

  const isAdmin = me?.role === "admin";

  const q = useQuery({
    queryKey: ["wb", "users"],
    queryFn: fetchWbUsers,
    enabled: isAdmin,
  });

  const createMut = useMutation({
    mutationFn: () =>
      createWbUser({ login: createLogin.trim(), role: createRole, displayName: createName.trim() || createLogin.trim() }),
    onSuccess: ({ user, password }) => {
      qc.invalidateQueries({ queryKey: ["wb", "users"] });
      setShowCreate(false);
      setCreateLogin(""); setCreateName(""); setCreateRole("viewer");
      setShownPassword({ login: user.login, password });
    },
    onError: (e: Error) => toast({ title: "Не создано", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (input: { id: string; patch: Parameters<typeof updateWbUser>[1] }) =>
      updateWbUser(input.id, input.patch),
    onSuccess: ({ user, password }) => {
      qc.invalidateQueries({ queryKey: ["wb", "users"] });
      if (password) setShownPassword({ login: user.login, password });
      else toast({ title: "Сохранено" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWbUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wb", "users"] });
      toast({ title: "Удалено" });
    },
    onError: (e: Error) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });

  // Deny-by-default: пока me не загружен — не показываем admin UI и не даём
  // запускать мутации. Если по факту окажется не admin — отрисуем forbidden.
  if (!me) {
    return (
      <WbShell>
        <div className="container mx-auto p-6 text-sm text-muted-foreground">
          Загрузка профиля…
        </div>
      </WbShell>
    );
  }
  if (!isAdmin) {
    return (
      <WbShell>
        <div className="container mx-auto p-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-2">Доступ запрещён</h2>
            <p className="text-sm text-muted-foreground">
              Раздел сотрудников доступен только администраторам.
            </p>
          </Card>
        </div>
      </WbShell>
    );
  }

  return (
    <WbShell>
      <div className="container mx-auto px-4 max-w-[1100px] py-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-semibold">Сотрудники</h1>
          <Button onClick={() => setShowCreate(true)} data-testid="btn-create-user">
            + Добавить сотрудника
          </Button>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Логин</th>
                  <th className="px-3 py-2">Имя</th>
                  <th className="px-3 py-2">Роль</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Создан</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Загрузка…</td></tr>
                )}
                {q.data && q.data.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Сотрудников нет</td></tr>
                )}
                {q.data?.map((u: WbUser) => (
                  <tr key={u.id} className="border-t" data-testid={`user-row-${u.id}`}>
                    <td className="px-3 py-2 font-mono">{u.login}</td>
                    <td className="px-3 py-2">{u.displayName}</td>
                    <td className="px-3 py-2">
                      <Badge variant={u.role === "admin" ? "default" : "outline"}>
                        {roleLabel(u.role)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {u.disabled ? (
                        <span className="text-xs text-muted-foreground">отключён</span>
                      ) : (
                        <span className="text-xs text-green-700">активен</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDt(u.createdAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap gap-1 justify-end">
                        <Button
                          size="sm" variant="outline"
                          onClick={() => updateMut.mutate({ id: u.id, patch: { resetPassword: true } })}
                          data-testid={`btn-reset-${u.id}`}
                        >
                          Новый пароль
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => updateMut.mutate({ id: u.id, patch: { disabled: !u.disabled } })}
                          data-testid={`btn-toggle-${u.id}`}
                        >
                          {u.disabled ? "Включить" : "Отключить"}
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => {
                            if (confirm(`Удалить сотрудника ${u.login}?`)) deleteMut.mutate(u.id);
                          }}
                          data-testid={`btn-delete-${u.id}`}
                        >
                          Удалить
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Создание */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый сотрудник</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Логин</Label>
              <Input
                value={createLogin}
                onChange={(e) => setCreateLogin(e.target.value)}
                placeholder="например, ivanov"
                autoComplete="off"
                data-testid="input-create-login"
              />
              <p className="text-xs text-muted-foreground">3–32 символа: латиница, цифры, . _ -</p>
            </div>
            <div className="space-y-1.5">
              <Label>Имя в интерфейсе</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Иванов И.И."
                data-testid="input-create-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Роль</Label>
              <Select value={createRole} onValueChange={(v) => setCreateRole(v as WbRole)}>
                <SelectTrigger data-testid="select-create-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Просмотр</SelectItem>
                  <SelectItem value="uploader">Загрузчик</SelectItem>
                  <SelectItem value="admin">Админ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Пароль сгенерируется автоматически и будет показан один раз.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Отмена</Button>
            <Button
              disabled={!createLogin.trim() || createMut.isPending}
              onClick={() => createMut.mutate()}
              data-testid="btn-submit-create"
            >
              {createMut.isPending ? "Создаю…" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Показ сгенерированного пароля */}
      <Dialog open={!!shownPassword} onOpenChange={(v) => !v && setShownPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Пароль сотрудника</DialogTitle>
          </DialogHeader>
          {shownPassword && (
            <div className="space-y-3">
              <p className="text-sm">
                Передайте сотруднику <b>{shownPassword.login}</b> следующие данные.
                Пароль больше не будет показан — сохраните его сейчас.
              </p>
              <div className="rounded border bg-muted p-3 font-mono text-lg select-all" data-testid="text-shown-password">
                {shownPassword.password}
              </div>
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(shownPassword.password);
                  toast({ title: "Скопировано" });
                }}
              >
                Скопировать
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShownPassword(null)}>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WbShell>
  );
}

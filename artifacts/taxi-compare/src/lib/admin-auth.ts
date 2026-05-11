// Тонкий shim: «админ» теперь = WB-пользователь с role='admin'.
//
// Было: захардкоженный sha256(login:password) в localStorage. Это давало
// доступ к админ-кнопкам любому, кто прочитает src/lib/admin-auth.ts на
// гитхабе или в DevTools. Заодно это было независимо от серверной
// /wb/me-роли — viewer мог поставить себе rwb_admin_v1=1 руками и видеть
// admin-кнопки (хоть API и блокировал бы 99% операций).
//
// Стало: useIsAdmin() → useWbCurrentUser()?.role === 'admin' (роль приходит
// с сервера через /wb/me и обновляется при логине/логауте). tryAdminLogin
// делегирует /wb/login и считает успехом ТОЛЬКО фактическую роль admin.
// logoutAdmin = wbLogout (сервер инвалидирует cookie+сессию).
//
// Backwards-compat: при импорте удаляем старый ключ "rwb_admin_v1", чтобы
// у юзеров не осталось артефакта прошлой схемы.

import { wbLogin, wbLogout } from "@/lib/wb-api";
import { useWbCurrentUser } from "@/lib/wb-auth";

const LEGACY_KEY = "rwb_admin_v1";
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* noop */
  }
}

export function useIsAdmin(): boolean {
  const me = useWbCurrentUser();
  return me?.role === "admin";
}

// «Войти как админ» теперь делегирует /wb/login. Возвращаем true ТОЛЬКО
// если фактическая роль — admin (viewer/antifraud попадут в WB-сессию,
// но isAdmin останется false — admin-кнопки им не покажем). UI после
// успешного wbLogin закроет форму, а useWbCurrentUser реактивно поднимет
// новую роль через слушатель wb-auth-changed.
export async function tryAdminLogin(
  login: string,
  password: string,
): Promise<boolean> {
  const r = await wbLogin(login, password);
  if (!r.ok) return false;
  return r.user?.role === "admin";
}

export function logoutAdmin(): void {
  void wbLogout();
}

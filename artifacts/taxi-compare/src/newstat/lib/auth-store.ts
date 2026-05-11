import { useEffect, useRef, useState } from "react";
import { newstatApi, getToken, setToken, type User } from "./api";

/**
 * Лёгкий hook без сторонних state-менеджеров (специально, чтобы модуль
 * легче выдрать в standalone). Слушает событие "newstat-auth-change",
 * которое диспатчит api.setToken().
 *
 * T006: при отсутствии newstat-токена ОДИН РАЗ за mount пробуем тихий SSO
 * через wb-сессию (HttpOnly cookie или legacy Bearer). Если получилось —
 * setToken() уведомит подписчиков и /me поднимется естественным циклом.
 */
export function useNewstatUser(): {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
} {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Пытаемся SSO только один раз за mount: если у юзера нет ни newstat-, ни
  // wb-сессии — мы не хотим ддосить /auth/sso на каждый ре-рендер.
  const ssoTriedRef = useRef(false);

  async function load() {
    setLoading(true);
    if (!getToken()) {
      // T006: нет newstat-токена — пробуем SSO через wb-сессию.
      if (!ssoTriedRef.current) {
        ssoTriedRef.current = true;
        const r = await newstatApi.sso();
        if (r.ok) {
          // setToken диспатчит newstat-auth-change → onChange вызовет load()
          // ещё раз и пройдёт по нижней ветке (с токеном).
          setToken(r.data.token);
          setUser(r.data.user);
          setLoading(false);
          return;
        }
        // SSO не получилось (нет wb-сессии / роль viewer / wb недоступен) —
        // это норма, просто остаёмся незалогиненным. NewstatLayout покажет
        // /newstat/login.
      }
      setUser(null);
      setLoading(false);
      return;
    }
    const r = await newstatApi.me();
    setUser(r.ok ? r.data.user : null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener("newstat-auth-change", onChange);
    return () => window.removeEventListener("newstat-auth-change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    user,
    loading,
    refresh: load,
    async signOut() {
      await newstatApi.logout();
      setToken(null);
      setUser(null);
      // После явного logout — позволим SSO снова попробовать при следующем mount.
      ssoTriedRef.current = false;
    },
  };
}

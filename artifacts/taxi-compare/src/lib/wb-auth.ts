// Хранение текущего WB-пользователя (роль/имя) в localStorage + хук useWbCurrentUser.
// Источник истины: ответ /wb/me. После логина WbAuthGate подтягивает /wb/me и
// кладёт результат сюда. Очищается вместе с токеном (через clearWbToken).

import { useEffect, useState } from "react";
import {
  fetchWbMe,
  getWbToken,
  onWbAuthChanged,
  type WbUser,
} from "@/lib/wb-api";

const USER_KEY = "wb_user_v1";

export function setStoredWbUser(u: WbUser | null): void {
  try {
    if (u) window.localStorage.setItem(USER_KEY, JSON.stringify(u));
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    /* noop */
  }
}

export function getStoredWbUser(): WbUser | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (u && typeof u === "object" && u.role && u.id) return u as WbUser;
    return null;
  } catch {
    return null;
  }
}

// Хук: при наличии токена возвращает кэшированного юзера и обновляет с /wb/me
// в фоне. При очистке токена — обнуляет.
export function useWbCurrentUser(): WbUser | null {
  const [user, setUser] = useState<WbUser | null>(() => getStoredWbUser());

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const t = getWbToken();
      if (!t) {
        if (!cancelled) {
          setStoredWbUser(null);
          setUser(null);
        }
        return;
      }
      // Захватываем токен до запроса — если за время полёта /wb/me юзер
      // успел разлогиниться/перелогиниться (как другая роль), мы должны
      // отбросить устаревший ответ, иначе старый user перепишет нового.
      const tokenAtStart = t;
      try {
        const u = await fetchWbMe();
        if (cancelled) return;
        if (getWbToken() !== tokenAtStart) return;
        setStoredWbUser(u);
        setUser(u);
      } catch {
        // Игнор — токен мог истечь, listener auth-event уберёт нас.
      }
    };
    sync();
    const off = onWbAuthChanged(() => {
      const t = getWbToken();
      if (!t) {
        setStoredWbUser(null);
        setUser(null);
      } else {
        // Новый токен → перечитаем профиль.
        sync();
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return user;
}

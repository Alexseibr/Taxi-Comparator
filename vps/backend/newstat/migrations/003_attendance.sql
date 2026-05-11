-- 003_attendance.sql
-- Гарантия выплат по сменам: для каждой пары (driver, date, shift) считаем
-- сколько часов смены водитель реально работал и положена ли ему гарантия.
--
-- attendance_pct = доля часов смены, в которых был хотя бы один заказ.
-- qualified = attendance_pct >= settings.risk_thresholds.min_attendance_pct.
-- payout_byn = shifts.payout_byn (если qualified) или 0.

CREATE TABLE IF NOT EXISTS driver_shift_attendance (
  driver_id        text          NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  date             date          NOT NULL,
  shift_id         integer       NOT NULL REFERENCES shifts(id)  ON DELETE CASCADE,
  shift_hours      smallint      NOT NULL,
  covered_hours    smallint      NOT NULL,
  attendance_pct   numeric(5,2)  NOT NULL,
  orders_in_shift  integer       NOT NULL,
  qualified        boolean       NOT NULL,
  payout_byn       numeric(10,2) NOT NULL,
  recomputed_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, date, shift_id)
);

CREATE INDEX IF NOT EXISTS idx_dsa_date            ON driver_shift_attendance(date);
CREATE INDEX IF NOT EXISTS idx_dsa_date_qualified  ON driver_shift_attendance(date, qualified);

-- При запуске миграции от postgres владелец таблицы — postgres, поэтому
-- newstat_user (рабочая роль сервиса) без отдельного GRANT не имеет прав.
GRANT SELECT, INSERT, UPDATE, DELETE ON driver_shift_attendance TO newstat_user;

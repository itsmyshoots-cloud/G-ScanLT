-- Restore the missing column-level UPDATE privileges needed by the
-- existing super-admin / admin-with-operator-tab correction workflow.
--
-- RLS remains the authorization boundary. This does not grant UPDATE on
-- identity, plan, audit, or other system-managed columns.

GRANT UPDATE (
  missing_serial_qty,
  missing_serial_start,
  missing_serial_end,
  alternate_serial_start,
  alternate_serial_end,
  serial_exceptions
)
ON TABLE public.pm_hourly_production
TO authenticated;

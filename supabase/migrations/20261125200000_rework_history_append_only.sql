-- Rework history is append-only. Only the private audit trigger (owned by
-- the database owner) may create rows; application users may read but never
-- insert, update, delete or truncate the audit log directly.
REVOKE ALL ON TABLE public.pm_rework_unit_history
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.pm_rework_unit_history TO authenticated;

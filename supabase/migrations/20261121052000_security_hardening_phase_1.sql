-- G-ScanLT security hardening phase 1
-- Preserve current user-facing role rules while moving privileged plan actions
-- out of the exposed public API schema.

CREATE OR REPLACE FUNCTION private.pm_close_plan(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_missing integer;
BEGIN
  IF auth.uid() IS NULL
     OR public.pm_current_role() NOT IN ('admin','supervisor','operator')
     OR NOT (
       public.pm_has_tab('operator')
       OR public.pm_has_tab('plans')
     ) THEN
    RAISE EXCEPTION 'An authenticated user with Operator or Production Plans access is required to close a production plan';
  END IF;

  SELECT count(*)
    INTO v_missing
  FROM public.pm_plan_hour_targets t
  LEFT JOIN public.pm_hourly_production h
    ON h.plan_id = t.plan_id AND h.hour_index = t.hour_index
  WHERE t.plan_id = p_plan_id AND h.id IS NULL;

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'All scheduled hourly records must be entered before shift close';
  END IF;

  UPDATE public.pm_production_plans
  SET status = 'completed', completed_at = now()
  WHERE id = p_plan_id AND status = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or is not currently Published';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.pm_publish_plan(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_total integer;
  v_hours integer;
BEGIN
  IF auth.uid() IS NULL
     OR public.pm_current_role() NOT IN ('admin','supervisor')
     OR NOT public.pm_has_tab('plans') THEN
    RAISE EXCEPTION 'Only an authenticated admin or supervisor with Production Plans access can publish a plan';
  END IF;

  SELECT count(*), coalesce(sum(planned_qty), 0)
    INTO v_hours, v_total
  FROM public.pm_plan_hour_targets
  WHERE plan_id = p_plan_id;

  IF v_hours < 1 OR v_hours > 24 THEN
    RAISE EXCEPTION 'A production plan must contain between 1 and 24 hourly intervals';
  END IF;

  UPDATE public.pm_production_plans
  SET status = 'published', published_at = now()
  WHERE id = p_plan_id
    AND status = 'draft'
    AND planned_qty = v_total;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found, not in Draft status, or hourly targets do not equal the shift target';
  END IF;
END;
$function$;

-- Private implementations are not exposed through the Supabase Data API.
-- Only authenticated users may execute them through the public invoker wrappers.
REVOKE ALL ON FUNCTION private.pm_close_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.pm_publish_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.pm_close_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.pm_publish_plan(uuid) TO authenticated, service_role;

-- Public RPC compatibility endpoints are deliberately SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.pm_close_plan(p_plan_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.pm_close_plan(p_plan_id);
$function$;

CREATE OR REPLACE FUNCTION public.pm_publish_plan(p_plan_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.pm_publish_plan(p_plan_id);
$function$;

REVOKE ALL ON FUNCTION public.pm_close_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pm_publish_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pm_close_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pm_publish_plan(uuid) TO authenticated, service_role;

-- Stop accidental browser-role access to newly created objects.
-- Existing table/function privileges are not changed by ALTER DEFAULT PRIVILEGES.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

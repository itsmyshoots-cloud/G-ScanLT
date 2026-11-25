-- Replace the definer view with a narrow, RLS-protected operator lookup table.
DROP VIEW IF EXISTS public.pm_rework_operator_options;

CREATE TABLE IF NOT EXISTS public.pm_rework_operator_options (
  id uuid PRIMARY KEY REFERENCES public.pm_user_profiles(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pm_rework_operator_options_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT pm_rework_operator_options_role_check CHECK (role IN ('operator','supervisor','admin'))
);

ALTER TABLE public.pm_rework_operator_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pm_rework_operator_options FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.pm_rework_operator_options TO authenticated;

DROP POLICY IF EXISTS pm_rework_operator_options_read ON public.pm_rework_operator_options;
CREATE POLICY pm_rework_operator_options_read
  ON public.pm_rework_operator_options
  FOR SELECT TO authenticated
  USING (public.pm_has_tab('rework'));

INSERT INTO public.pm_rework_operator_options (id,full_name,role)
SELECT p.id,p.full_name,p.role
FROM public.pm_user_profiles p
WHERE p.is_active=true
  AND p.role IN ('operator','supervisor','admin')
  AND NULLIF(btrim(p.full_name),'') IS NOT NULL
  AND p.full_name <> 'Name not provided'
ON CONFLICT (id) DO UPDATE
SET full_name=EXCLUDED.full_name, role=EXCLUDED.role, updated_at=now();

CREATE OR REPLACE FUNCTION private.pm_sync_rework_operator_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM public.pm_rework_operator_options WHERE id=OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_active=true
     AND NEW.role IN ('operator','supervisor','admin')
     AND NULLIF(btrim(NEW.full_name),'') IS NOT NULL
     AND NEW.full_name <> 'Name not provided' THEN
    INSERT INTO public.pm_rework_operator_options (id,full_name,role,updated_at)
    VALUES (NEW.id,NEW.full_name,NEW.role,now())
    ON CONFLICT (id) DO UPDATE
      SET full_name=EXCLUDED.full_name,
          role=EXCLUDED.role,
          updated_at=now();
  ELSE
    DELETE FROM public.pm_rework_operator_options WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.pm_sync_rework_operator_options() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pm_sync_rework_operator_options ON public.pm_user_profiles;
CREATE TRIGGER pm_sync_rework_operator_options
AFTER INSERT OR UPDATE OR DELETE ON public.pm_user_profiles
FOR EACH ROW EXECUTE FUNCTION private.pm_sync_rework_operator_options();

-- Use separate write policies to avoid giving the authenticated role
-- an unnecessary permissive SELECT policy through FOR ALL.
DROP POLICY IF EXISTS pm_rework_problem_types_manage ON public.pm_rework_problem_types;
DROP POLICY IF EXISTS pm_rework_components_manage ON public.pm_rework_components;

CREATE POLICY pm_rework_problem_types_insert
  ON public.pm_rework_problem_types FOR INSERT TO authenticated
  WITH CHECK (public.pm_has_tab('rework') AND public.pm_current_role()='admin');

CREATE POLICY pm_rework_problem_types_update
  ON public.pm_rework_problem_types FOR UPDATE TO authenticated
  USING (public.pm_has_tab('rework') AND public.pm_current_role()='admin')
  WITH CHECK (public.pm_has_tab('rework') AND public.pm_current_role()='admin');

CREATE POLICY pm_rework_components_insert
  ON public.pm_rework_components FOR INSERT TO authenticated
  WITH CHECK (public.pm_has_tab('rework') AND public.pm_current_role()='admin');

CREATE POLICY pm_rework_components_update
  ON public.pm_rework_components FOR UPDATE TO authenticated
  USING (public.pm_has_tab('rework') AND public.pm_current_role()='admin')
  WITH CHECK (public.pm_has_tab('rework') AND public.pm_current_role()='admin');

-- Index all new foreign keys.
CREATE INDEX IF NOT EXISTS pm_rework_problem_types_created_by_idx
  ON public.pm_rework_problem_types(created_by);
CREATE INDEX IF NOT EXISTS pm_rework_components_created_by_idx
  ON public.pm_rework_components(created_by);
CREATE INDEX IF NOT EXISTS pm_rework_history_changed_by_idx
  ON public.pm_rework_unit_history(changed_by);
CREATE INDEX IF NOT EXISTS pm_rework_units_operator_profile_idx
  ON public.pm_rework_units(operator_profile_id);

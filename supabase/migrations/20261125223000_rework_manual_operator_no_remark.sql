-- Allow manually entered operator names and remove the mandatory rework remark.
-- The existing immutable audit trigger remains enabled and continues recording before/after data.
CREATE OR REPLACE FUNCTION public.pm_guard_rework_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_problem_exists boolean;
  v_operator_exists boolean;
  v_material_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.pm_has_tab('rework') THEN
    RAISE EXCEPTION 'You do not have permission to update rework records';
  END IF;

  v_is_admin := public.pm_current_role() = 'admin' OR public.pm_is_super_admin();

  IF NEW.hourly_production_id <> OLD.hourly_production_id
     OR NEW.unit_number <> OLD.unit_number
     OR NEW.original_reason <> OLD.original_reason THEN
    RAISE EXCEPTION 'Original rejection linkage and reason are immutable';
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'pending' THEN
    -- Internal serial-number reconciliation performed by the trusted hourly
    -- rejection-sync trigger may update only the serial field.
    IF current_user = 'postgres'
       AND (to_jsonb(NEW) - 'serial_number') = (to_jsonb(OLD) - 'serial_number') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Pending rework details must be saved with a final outcome';
  ELSIF OLD.status = 'pending' THEN
    IF public.pm_current_role() NOT IN ('admin', 'supervisor', 'operator') THEN
      RAISE EXCEPTION 'Your role cannot resolve rejected units';
    END IF;

    IF NEW.status NOT IN ('completed', 'finally_rejected') THEN
      RAISE EXCEPTION 'Select Rework completed or Finally rejected';
    END IF;
  ELSE
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Only Admin or Super Admin can correct a resolved rework record';
    END IF;
    IF NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'A correction cannot silently change the final disposition';
    END IF;
    IF NULLIF(btrim(NEW.correction_note), '') IS NULL THEN
      RAISE EXCEPTION 'Enter a correction reason so the change can be audited';
    END IF;
  END IF;

  IF NULLIF(btrim(NEW.serial_number), '') IS NULL THEN
    RAISE EXCEPTION 'Enter or capture the rejected unit serial number';
  END IF;

  IF NULLIF(btrim(NEW.problem_type), '') IS NULL THEN
    RAISE EXCEPTION 'Select a problem type';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.pm_rework_problem_types
    WHERE name = NEW.problem_type
      AND (is_active OR OLD.problem_type = NEW.problem_type)
  ) INTO v_problem_exists;
  IF NOT v_problem_exists THEN
    RAISE EXCEPTION 'The selected problem type is unavailable. Refresh the list and select an active problem type';
  END IF;

  IF NEW.rework_details IS NULL OR NEW.rework_details NOT IN ('adjusted', 'component_changed') THEN
    RAISE EXCEPTION 'Select Adjusted or Component Changed';
  END IF;
  IF NEW.rework_type IS NULL OR NEW.rework_type NOT IN ('incoming_rejection', 'process_rejection') THEN
    RAISE EXCEPTION 'Select Incoming Rejection or Process Rejection';
  END IF;

  IF NEW.rework_details = 'adjusted' THEN
    IF jsonb_array_length(NEW.material_changed) <> 0 THEN
      RAISE EXCEPTION 'Material Changed must be empty when Rework Details is Adjusted';
    END IF;
  ELSE
    v_material_count := jsonb_array_length(NEW.material_changed);
    IF v_material_count = 0 THEN
      RAISE EXCEPTION 'Select at least one component when Rework Details is Component Changed';
    END IF;
    IF (
      SELECT count(DISTINCT component_id)
      FROM jsonb_to_recordset(NEW.material_changed) AS x(component_id uuid)
    ) <> v_material_count THEN
      RAISE EXCEPTION 'A component can only be selected once';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(NEW.material_changed) AS x(component_id uuid, component_name text)
      LEFT JOIN public.pm_rework_components c ON c.id = x.component_id
      WHERE c.id IS NULL
         OR c.name IS DISTINCT FROM x.component_name
         OR (NOT c.is_active AND NOT EXISTS (
           SELECT 1
           FROM jsonb_to_recordset(OLD.material_changed) AS oldx(component_id uuid)
           WHERE oldx.component_id = c.id
         ))
    ) THEN
      RAISE EXCEPTION 'One or more selected components are unavailable. Refresh the list and select active components';
    END IF;
  END IF;

  IF NULLIF(btrim(NEW.operator_name), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the operator name';
  END IF;
  -- Operator names may be entered manually. When an entered name matches an
  -- active profile, the UI may optionally retain that profile link.
  IF NEW.operator_profile_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.pm_rework_operator_options o
      WHERE o.id = NEW.operator_profile_id
        AND o.full_name = NEW.operator_name
    ) INTO v_operator_exists;
    IF NOT v_operator_exists THEN
      RAISE EXCEPTION 'The linked operator profile is not active or available';
    END IF;
  END IF;

  IF OLD.status = 'pending' THEN
    NEW.resolved_by := auth.uid();
    NEW.resolved_at := now();
    NEW.rework_saved_at := now();
    NEW.correction_note := NULL;
  ELSE
    NEW.corrected_by := auth.uid();
    NEW.corrected_at := now();
    NEW.rework_saved_at := now();
  END IF;

  RETURN NEW;
END;
$function$;



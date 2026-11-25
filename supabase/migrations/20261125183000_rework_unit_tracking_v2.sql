-- G-ScanLT: unit-level rework tracking, serial capture and correction audit
-- Additive migration. Existing production and rework rows are preserved.

ALTER TABLE public.pm_hourly_production
  ADD COLUMN IF NOT EXISTS rejected_serials jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.pm_hourly_production
  DROP CONSTRAINT IF EXISTS pm_hourly_production_rejected_serials_array_check;
ALTER TABLE public.pm_hourly_production
  ADD CONSTRAINT pm_hourly_production_rejected_serials_array_check
  CHECK (jsonb_typeof(rejected_serials) = 'array');

ALTER TABLE public.pm_rework_units
  ADD COLUMN IF NOT EXISTS problem_type text,
  ADD COLUMN IF NOT EXISTS rework_details text,
  ADD COLUMN IF NOT EXISTS material_changed jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rework_type text,
  ADD COLUMN IF NOT EXISTS operator_profile_id uuid,
  ADD COLUMN IF NOT EXISTS operator_name text,
  ADD COLUMN IF NOT EXISTS rework_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS correction_note text,
  ADD COLUMN IF NOT EXISTS corrected_by uuid,
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz;

ALTER TABLE public.pm_rework_units
  DROP CONSTRAINT IF EXISTS pm_rework_units_material_changed_array_check,
  DROP CONSTRAINT IF EXISTS pm_rework_units_rework_details_check,
  DROP CONSTRAINT IF EXISTS pm_rework_units_rework_type_check;
ALTER TABLE public.pm_rework_units
  ADD CONSTRAINT pm_rework_units_material_changed_array_check
    CHECK (jsonb_typeof(material_changed) = 'array'),
  ADD CONSTRAINT pm_rework_units_rework_details_check
    CHECK (rework_details IS NULL OR rework_details IN ('adjusted', 'component_changed')),
  ADD CONSTRAINT pm_rework_units_rework_type_check
    CHECK (rework_type IS NULL OR rework_type IN ('incoming_rejection', 'process_rejection'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pm_rework_units'::regclass
      AND conname = 'pm_rework_units_operator_profile_id_fkey'
  ) THEN
    ALTER TABLE public.pm_rework_units
      ADD CONSTRAINT pm_rework_units_operator_profile_id_fkey
      FOREIGN KEY (operator_profile_id)
      REFERENCES public.pm_user_profiles(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS pm_rework_units_serial_number_uidx
  ON public.pm_rework_units (serial_number)
  WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '';

CREATE TABLE IF NOT EXISTS public.pm_rework_problem_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pm_rework_problem_types_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS pm_rework_problem_types_name_uidx
  ON public.pm_rework_problem_types (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.pm_rework_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  component_code text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pm_rework_components_name_not_blank CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS pm_rework_components_name_uidx
  ON public.pm_rework_components (lower(btrim(name)));

-- This log intentionally has no FK to pm_rework_units: when an un-resolved
-- pending row is removed because an admin reduces a rejection count, its
-- immutable history must remain available.
CREATE TABLE IF NOT EXISTS public.pm_rework_unit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_rework_unit_id uuid NOT NULL,
  hourly_production_id uuid,
  unit_number integer,
  serial_snapshot text,
  event_type text NOT NULL,
  before_values jsonb,
  after_values jsonb,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  change_reason text,
  CONSTRAINT pm_rework_unit_history_event_type_check
    CHECK (event_type IN ('created', 'resolved', 'corrected', 'serial_updated', 'removed_pending'))
);

CREATE INDEX IF NOT EXISTS pm_rework_unit_history_unit_idx
  ON public.pm_rework_unit_history (source_rework_unit_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS pm_rework_unit_history_hour_idx
  ON public.pm_rework_unit_history (hourly_production_id, unit_number, changed_at DESC);

ALTER TABLE public.pm_rework_problem_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_rework_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_rework_unit_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pm_rework_problem_types FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.pm_rework_components FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.pm_rework_unit_history FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pm_rework_problem_types TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pm_rework_components TO authenticated;
GRANT SELECT ON TABLE public.pm_rework_unit_history TO authenticated;

DROP POLICY IF EXISTS pm_rework_problem_types_read ON public.pm_rework_problem_types;
CREATE POLICY pm_rework_problem_types_read
  ON public.pm_rework_problem_types
  FOR SELECT TO authenticated
  USING (public.pm_has_tab('rework'));

DROP POLICY IF EXISTS pm_rework_problem_types_manage ON public.pm_rework_problem_types;
CREATE POLICY pm_rework_problem_types_manage
  ON public.pm_rework_problem_types
  FOR ALL TO authenticated
  USING (
    public.pm_has_tab('rework')
    AND (public.pm_current_role() = 'admin' OR public.pm_is_super_admin())
  )
  WITH CHECK (
    public.pm_has_tab('rework')
    AND (public.pm_current_role() = 'admin' OR public.pm_is_super_admin())
  );

DROP POLICY IF EXISTS pm_rework_components_read ON public.pm_rework_components;
CREATE POLICY pm_rework_components_read
  ON public.pm_rework_components
  FOR SELECT TO authenticated
  USING (public.pm_has_tab('rework'));

DROP POLICY IF EXISTS pm_rework_components_manage ON public.pm_rework_components;
CREATE POLICY pm_rework_components_manage
  ON public.pm_rework_components
  FOR ALL TO authenticated
  USING (
    public.pm_has_tab('rework')
    AND (public.pm_current_role() = 'admin' OR public.pm_is_super_admin())
  )
  WITH CHECK (
    public.pm_has_tab('rework')
    AND (public.pm_current_role() = 'admin' OR public.pm_is_super_admin())
  );

DROP POLICY IF EXISTS pm_rework_unit_history_read ON public.pm_rework_unit_history;
CREATE POLICY pm_rework_unit_history_read
  ON public.pm_rework_unit_history
  FOR SELECT TO authenticated
  USING (public.pm_has_tab('rework'));

-- Expose only a minimal operator list. The underlying profile table deliberately
-- remains private to each user and the super administrator.
CREATE OR REPLACE VIEW public.pm_rework_operator_options
WITH (security_invoker = false, security_barrier = true)
AS
SELECT p.id, p.full_name, p.role
FROM public.pm_user_profiles p
WHERE p.is_active = true
  AND p.role IN ('operator', 'supervisor', 'admin')
  AND NULLIF(btrim(p.full_name), '') IS NOT NULL
  AND p.full_name <> 'Name not provided'
  AND public.pm_has_tab('rework');

REVOKE ALL ON TABLE public.pm_rework_operator_options FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.pm_rework_operator_options TO authenticated;

-- Rework unit updates remain guarded by the existing trigger, with new
-- per-unit repair fields and explicit admin-only correction of resolved units.
GRANT UPDATE (
  serial_number,
  problem_type,
  rework_details,
  material_changed,
  rework_type,
  operator_profile_id,
  operator_name,
  resolution_remark,
  status,
  correction_note
)
ON TABLE public.pm_rework_units TO authenticated;

DROP POLICY IF EXISTS rework_resolve_pending ON public.pm_rework_units;
CREATE POLICY rework_resolve_pending
  ON public.pm_rework_units
  FOR UPDATE TO authenticated
  USING (
    public.pm_has_tab('rework')
    AND (
      (status = 'pending' AND public.pm_current_role() IN ('admin', 'supervisor', 'operator'))
      OR
      (status IN ('completed', 'finally_rejected')
       AND (public.pm_current_role() = 'admin' OR public.pm_is_super_admin()))
    )
  )
  WITH CHECK (
    public.pm_has_tab('rework')
    AND public.pm_current_role() IN ('admin', 'supervisor', 'operator')
    AND status IN ('completed', 'finally_rejected')
  );

-- Preserve compatibility with the older hourly-entry application during the
-- Preview period: an empty rejected_serials array is accepted for old clients.
-- Once the new hourly-entry form is promoted to Production, a follow-up migration
-- can enforce one serial per newly recorded rejected unit.
CREATE OR REPLACE FUNCTION public.pm_sync_rework_units()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total integer;
  v_resolved integer;
  v_needed integer;
  v_serials jsonb;
  v_serial text;
  v_row record;
BEGIN
  v_serials := COALESCE(NEW.rejected_serials, '[]'::jsonb);

  IF jsonb_typeof(v_serials) <> 'array' THEN
    RAISE EXCEPTION 'Rejected serial numbers must be supplied as a list';
  END IF;

  IF jsonb_array_length(v_serials) > 0
     AND jsonb_array_length(v_serials) <> NEW.rejected_qty THEN
    RAISE EXCEPTION 'Enter exactly one rejected serial number for each rejected unit';
  END IF;

  IF jsonb_array_length(v_serials) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT lower(btrim(value #>> '{}')) AS serial_value, count(*) AS qty
        FROM jsonb_array_elements(v_serials)
        GROUP BY lower(btrim(value #>> '{}'))
      ) duplicates
      WHERE serial_value = '' OR qty > 1
    ) THEN
      RAISE EXCEPTION 'Rejected serial numbers must be non-empty and unique';
    END IF;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE status <> 'pending')
    INTO v_total, v_resolved
  FROM public.pm_rework_units
  WHERE hourly_production_id = NEW.id;

  IF NEW.rejected_qty < v_resolved THEN
    RAISE EXCEPTION 'Rejected quantity cannot be reduced below the number of already resolved units';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pm_rework_units
    WHERE hourly_production_id = NEW.id
      AND status <> 'pending'
      AND unit_number > NEW.rejected_qty
  ) THEN
    RAISE EXCEPTION 'Rejected quantity cannot exclude a unit that already has a final disposition';
  END IF;

  IF v_total > NEW.rejected_qty THEN
    DELETE FROM public.pm_rework_units
    WHERE id IN (
      SELECT id
      FROM public.pm_rework_units
      WHERE hourly_production_id = NEW.id
        AND status = 'pending'
        AND unit_number > NEW.rejected_qty
      ORDER BY unit_number DESC
    );
  END IF;

  -- Update serials only for pending units. Resolved serial corrections must
  -- go through the audited Admin / Super Admin correction form.
  IF jsonb_array_length(v_serials) > 0 THEN
    FOR v_row IN
      SELECT id, unit_number, status, serial_number
      FROM public.pm_rework_units
      WHERE hourly_production_id = NEW.id
        AND unit_number <= NEW.rejected_qty
      ORDER BY unit_number
    LOOP
      v_serial := NULLIF(btrim(v_serials ->> (v_row.unit_number - 1)), '');
      IF v_row.status = 'pending' THEN
        UPDATE public.pm_rework_units
        SET serial_number = v_serial
        WHERE id = v_row.id
          AND serial_number IS DISTINCT FROM v_serial;
      ELSIF v_row.serial_number IS NOT NULL
            AND v_row.serial_number IS DISTINCT FROM v_serial THEN
        RAISE EXCEPTION 'A resolved unit serial must be corrected from the Rework Workspace';
      END IF;
    END LOOP;
  END IF;

  SELECT count(*) INTO v_total
  FROM public.pm_rework_units
  WHERE hourly_production_id = NEW.id;

  v_needed := NEW.rejected_qty - v_total;

  IF v_needed > 0 THEN
    INSERT INTO public.pm_rework_units (
      hourly_production_id, unit_number, serial_number, original_reason
    )
    SELECT
      NEW.id,
      series.n,
      CASE
        WHEN jsonb_array_length(v_serials) >= series.n
          THEN NULLIF(btrim(v_serials ->> (series.n - 1)), '')
        ELSE NULL
      END,
      COALESCE(NULLIF(btrim(NEW.rejection_reason), ''), 'Not recorded at hourly entry')
    FROM generate_series(1, NEW.rejected_qty) AS series(n)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.pm_rework_units existing
      WHERE existing.hourly_production_id = NEW.id
        AND existing.unit_number = series.n
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pm_hourly_sync_rework ON public.pm_hourly_production;
CREATE TRIGGER pm_hourly_sync_rework
AFTER INSERT OR UPDATE OF rejected_qty, rejected_serials
ON public.pm_hourly_production
FOR EACH ROW
EXECUTE FUNCTION public.pm_sync_rework_units();

-- Guard first-time resolution and allow controlled, audited corrections by Admin.
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

  IF OLD.status = 'pending' THEN
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

  IF NEW.rework_details NOT IN ('adjusted', 'component_changed') THEN
    RAISE EXCEPTION 'Select Adjusted or Component Changed';
  END IF;
  IF NEW.rework_type NOT IN ('incoming_rejection', 'process_rejection') THEN
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
         OR c.name <> x.component_name
         OR (NOT c.is_active AND NOT EXISTS (
           SELECT 1
           FROM jsonb_to_recordset(OLD.material_changed) AS oldx(component_id uuid)
           WHERE oldx.component_id = c.id
         ))
    ) THEN
      RAISE EXCEPTION 'One or more selected components are unavailable. Refresh the list and select active components';
    END IF;
  END IF;

  IF NULLIF(btrim(NEW.operator_name), '') IS NULL OR NEW.operator_profile_id IS NULL THEN
    RAISE EXCEPTION 'Select the operator who performed the rework';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM public.pm_rework_operator_options o
    WHERE o.id = NEW.operator_profile_id
      AND o.full_name = NEW.operator_name
  ) INTO v_operator_exists;
  IF NOT v_operator_exists AND (
    OLD.operator_profile_id IS DISTINCT FROM NEW.operator_profile_id
    OR OLD.operator_name IS DISTINCT FROM NEW.operator_name
  ) THEN
    RAISE EXCEPTION 'The selected operator is not active or available';
  END IF;

  IF NULLIF(btrim(NEW.resolution_remark), '') IS NULL THEN
    RAISE EXCEPTION 'Enter a resolution remark';
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

-- Append-only audit history for create, resolve, corrections, pending-row removals
-- and serial changes triggered by hourly-entry corrections.
CREATE OR REPLACE FUNCTION private.pm_log_rework_unit_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_unit_id uuid;
  v_hourly_id uuid;
  v_unit_number integer;
  v_serial text;
  v_status text;
  v_actor uuid;
  v_actor_name text;
  v_event text;
  v_change_reason text;
BEGIN
  v_actor := auth.uid();

  IF TG_OP = 'DELETE' THEN
    v_old := jsonb_build_object(
      'serial_number', OLD.serial_number,
      'original_reason', OLD.original_reason,
      'status', OLD.status,
      'problem_type', OLD.problem_type,
      'rework_details', OLD.rework_details,
      'material_changed', OLD.material_changed,
      'rework_type', OLD.rework_type,
      'operator_profile_id', OLD.operator_profile_id,
      'operator_name', OLD.operator_name,
      'resolution_remark', OLD.resolution_remark,
      'resolved_at', OLD.resolved_at
    );
    v_unit_id := OLD.id;
    v_hourly_id := OLD.hourly_production_id;
    v_unit_number := OLD.unit_number;
    v_serial := OLD.serial_number;
    v_status := OLD.status;
    v_event := 'removed_pending';
    v_change_reason := 'Pending unit removed because the hourly rejection quantity was reduced';
  ELSE
    v_new := jsonb_build_object(
      'serial_number', NEW.serial_number,
      'original_reason', NEW.original_reason,
      'status', NEW.status,
      'problem_type', NEW.problem_type,
      'rework_details', NEW.rework_details,
      'material_changed', NEW.material_changed,
      'rework_type', NEW.rework_type,
      'operator_profile_id', NEW.operator_profile_id,
      'operator_name', NEW.operator_name,
      'resolution_remark', NEW.resolution_remark,
      'resolved_at', NEW.resolved_at,
      'rework_saved_at', NEW.rework_saved_at,
      'correction_note', NEW.correction_note
    );
    v_unit_id := NEW.id;
    v_hourly_id := NEW.hourly_production_id;
    v_unit_number := NEW.unit_number;
    v_serial := NEW.serial_number;
    v_status := NEW.status;
    IF TG_OP = 'INSERT' THEN
      v_event := 'created';
    ELSIF OLD.status = 'pending' AND NEW.status IN ('completed', 'finally_rejected') THEN
      v_event := 'resolved';
    ELSIF OLD.serial_number IS DISTINCT FROM NEW.serial_number
       AND OLD.status = NEW.status
       AND OLD.problem_type IS NOT DISTINCT FROM NEW.problem_type
       AND OLD.rework_details IS NOT DISTINCT FROM NEW.rework_details
       AND OLD.material_changed IS NOT DISTINCT FROM NEW.material_changed
       AND OLD.rework_type IS NOT DISTINCT FROM NEW.rework_type
       AND OLD.operator_profile_id IS NOT DISTINCT FROM NEW.operator_profile_id
       AND OLD.operator_name IS NOT DISTINCT FROM NEW.operator_name
       AND OLD.resolution_remark IS NOT DISTINCT FROM NEW.resolution_remark THEN
      v_event := 'serial_updated';
    ELSE
      v_event := 'corrected';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      v_old := jsonb_build_object(
        'serial_number', OLD.serial_number,
        'original_reason', OLD.original_reason,
        'status', OLD.status,
        'problem_type', OLD.problem_type,
        'rework_details', OLD.rework_details,
        'material_changed', OLD.material_changed,
        'rework_type', OLD.rework_type,
        'operator_profile_id', OLD.operator_profile_id,
        'operator_name', OLD.operator_name,
        'resolution_remark', OLD.resolution_remark,
        'resolved_at', OLD.resolved_at,
        'rework_saved_at', OLD.rework_saved_at,
        'correction_note', OLD.correction_note
      );
      v_change_reason := NULLIF(btrim(NEW.correction_note), '');
    END IF;
  END IF;

  SELECT p.full_name
    INTO v_actor_name
  FROM public.pm_user_profiles p
  WHERE p.id = v_actor;

  INSERT INTO public.pm_rework_unit_history (
    source_rework_unit_id, hourly_production_id, unit_number,
    serial_snapshot, event_type, before_values, after_values,
    changed_by, changed_by_name, change_reason
  ) VALUES (
    v_unit_id, v_hourly_id, v_unit_number,
    v_serial, v_event, v_old, v_new,
    v_actor, COALESCE(v_actor_name, 'System'), v_change_reason
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.pm_log_rework_unit_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pm_rework_unit_history_audit ON public.pm_rework_units;
CREATE TRIGGER pm_rework_unit_history_audit
AFTER INSERT OR UPDATE OR DELETE
ON public.pm_rework_units
FOR EACH ROW
EXECUTE FUNCTION private.pm_log_rework_unit_history();

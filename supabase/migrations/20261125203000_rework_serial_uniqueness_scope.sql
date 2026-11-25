-- Serial numbers may be reused by different production plans/products.
-- Prevent duplicates within a single hourly record, not globally across all production.
DROP INDEX IF EXISTS public.pm_rework_units_serial_number_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS pm_rework_units_hour_serial_uidx
  ON public.pm_rework_units (hourly_production_id, lower(serial_number))
  WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '';

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
      RAISE EXCEPTION 'Rejected serial numbers must be non-empty and unique within this hour';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_serials) supplied(serial_value)
      JOIN public.pm_rework_units r
        ON lower(r.serial_number) = lower(btrim(supplied.serial_value))
      JOIN public.pm_hourly_production other_hour
        ON other_hour.id = r.hourly_production_id
      WHERE other_hour.plan_id = NEW.plan_id
        AND other_hour.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'A rejected serial number is already assigned to another hour in this production plan';
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
      ELSIF v_row.serial_number IS DISTINCT FROM v_serial THEN
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

CREATE OR REPLACE FUNCTION private.pm_validate_rework_unit_serial_unique()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_plan_id uuid;
BEGIN
  IF NEW.serial_number IS NULL OR btrim(NEW.serial_number)='' THEN
    RETURN NEW;
  END IF;

  SELECT h.plan_id
    INTO v_plan_id
  FROM public.pm_hourly_production h
  WHERE h.id=NEW.hourly_production_id;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'Hourly production entry was not found for this rejected unit';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pm_rework_units r
    JOIN public.pm_hourly_production h ON h.id=r.hourly_production_id
    WHERE r.id IS DISTINCT FROM NEW.id
      AND lower(r.serial_number)=lower(btrim(NEW.serial_number))
      AND h.plan_id=v_plan_id
  ) THEN
    RAISE EXCEPTION 'Serial % is already assigned to another rejected unit in this production plan', NEW.serial_number;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.pm_validate_rework_unit_serial_unique() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pm_rework_unit_serial_unique_guard ON public.pm_rework_units;
CREATE TRIGGER pm_rework_unit_serial_unique_guard
BEFORE INSERT OR UPDATE OF serial_number
ON public.pm_rework_units
FOR EACH ROW
EXECUTE FUNCTION private.pm_validate_rework_unit_serial_unique();

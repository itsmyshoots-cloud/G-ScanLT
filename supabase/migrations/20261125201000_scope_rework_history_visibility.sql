DROP POLICY IF EXISTS pm_rework_unit_history_read ON public.pm_rework_unit_history;
CREATE POLICY pm_rework_unit_history_read
ON public.pm_rework_unit_history
FOR SELECT TO authenticated
USING (
  public.pm_has_tab('rework')
  AND (
    public.pm_current_role() IN ('admin','supervisor')
    OR EXISTS (
      SELECT 1
      FROM public.pm_hourly_production h
      JOIN public.pm_production_plans p ON p.id=h.plan_id
      WHERE h.id=pm_rework_unit_history.hourly_production_id
        AND p.status IN ('published','completed')
    )
  )
);

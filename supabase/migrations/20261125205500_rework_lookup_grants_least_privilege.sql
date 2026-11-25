-- Keep the operator lookup strictly read-only for signed-in application users.
REVOKE ALL ON TABLE public.pm_rework_operator_options FROM authenticated, anon, PUBLIC;
GRANT SELECT ON TABLE public.pm_rework_operator_options TO authenticated;

-- Master lists are maintained through insert/update and soft-deactivation only.
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.pm_rework_problem_types, public.pm_rework_components
FROM authenticated, anon, PUBLIC;

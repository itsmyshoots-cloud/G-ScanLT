-- Seed the factory-provided Material Changed component list in supplied order.
-- Idempotent: matching labels are reactivated and reordered, not duplicated.
INSERT INTO public.pm_rework_components (name, sort_order)
VALUES
('Lamp', 1),
('Convection motor', 2),
('Rotisserie motor', 3),
('Heating element', 4),
('Housing', 5),
('Indicator lamp', 6),
('Power cord', 7),
('Display board', 8),
('Mother board', 9),
('Glass inner', 10),
('Glass outer', 11),
('Front panel', 12),
('Handle', 13),
('Lower bracket', 14),
('Upper bracket', 15),
('Sensor wire', 16),
('Timer', 17),
('thermostat', 18),
('switch', 19),
('Rear plate', 20),
('Top plate', 21),
('Right plate', 22),
('Bottom plate', 23),
('Control panel glass', 24)
ON CONFLICT ((lower(btrim(name)))) DO UPDATE
SET sort_order = EXCLUDED.sort_order,
    is_active = true,
    updated_at = now()
RETURNING id, name, sort_order;
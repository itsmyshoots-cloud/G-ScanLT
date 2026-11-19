-- Optional demonstration catalogue for the staging environment.
-- Safe to run after the initial migration. All names remain editable in the app.

insert into public.pm_brands (name)
values ('Gerat'), ('Cuisino'), ('Kabel'), ('Bajaj')
on conflict (name) do nothing;

insert into public.pm_products (brand_id, name)
select b.id, v.product_name
from (values
  ('Gerat', 'Mixer A'),
  ('Gerat', 'Kettle B'),
  ('Gerat', 'Product A'),
  ('Cuisino', 'Cooker C'),
  ('Cuisino', 'Product C'),
  ('Kabel', 'Cable Set'),
  ('Kabel', 'Product K'),
  ('Bajaj', 'OTG')
) as v(brand_name, product_name)
join public.pm_brands b on b.name = v.brand_name
on conflict (brand_id, name) do nothing;

insert into public.pm_models (product_id, model_number)
select p.id, v.model_number
from (values
  ('Gerat', 'Mixer A', 'MIX-A'),
  ('Gerat', 'Kettle B', 'KET-B'),
  ('Gerat', 'Product A', 'MOD-A'),
  ('Cuisino', 'Cooker C', 'CKR-C'),
  ('Cuisino', 'Product C', 'MOD-C'),
  ('Kabel', 'Cable Set', 'CBL-01'),
  ('Kabel', 'Product K', 'MOD-K'),
  ('Bajaj', 'OTG', 'RCAD 60')
) as v(brand_name, product_name, model_number)
join public.pm_brands b on b.name = v.brand_name
join public.pm_products p on p.brand_id = b.id and p.name = v.product_name
on conflict (product_id, model_number) do nothing;

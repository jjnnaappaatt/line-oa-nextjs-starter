-- Seed the singleton settings row and a couple of demo projects so the app has something to show.
-- Safe to run more than once.
insert into public.settings (id) values (1) on conflict (id) do nothing;

insert into public.projects (name, region)
select * from (values
  ('Demo Project North', 'North'),
  ('Demo Project South', 'South')
) as v(name, region)
where not exists (select 1 from public.projects);

-- Preparation-only SQL skeletons for the grounding-regime / phase-eligibility work.
-- These are NOT active migrations yet. They exist to make the implementation
-- concrete and reviewable before touching runtime behavior.

-- ---------------------------------------------------------------------------
-- 027_grounding_regime_meta.sql
-- ---------------------------------------------------------------------------

-- 1. Self-perspective helper accessors

create or replace function tqda_self_props(p_naming_id uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(a.properties, '{}'::jsonb)
  from appearances a
  where a.naming_id = p_naming_id
    and a.perspective_id = p_naming_id
    and a.mode = 'perspective'
  limit 1
$$;

create or replace function tqda_grounding_regime(p_naming_id uuid)
returns text
language sql
stable
as $$
  select coalesce(
    tqda_self_props(p_naming_id)->>'groundingRegime',
    case
      when tqda_self_props(p_naming_id)->>'role' in ('grounding-workspace', 'memo-system', 'docnet')
        then 'infrastructural'
      when tqda_self_props(p_naming_id)->>'role' = 'phase'
        then 'analytic'
      when tqda_self_props(p_naming_id)->>'mapType' is not null
        then 'analytic'
      else 'empirical'
    end
  )
$$;

create or replace function tqda_analytic_form(p_naming_id uuid)
returns text
language sql
stable
as $$
  select coalesce(
    tqda_self_props(p_naming_id)->>'analyticForm',
    case
      when tqda_self_props(p_naming_id)->>'role' = 'phase' then 'phase'
      when tqda_self_props(p_naming_id)->>'mapType' is not null then 'map'
      else null
    end
  )
$$;

create or replace function tqda_phase_eligible(p_naming_id uuid)
returns boolean
language sql
stable
as $$
  select tqda_grounding_regime(p_naming_id) = 'empirical'
$$;

-- 2. Backfill known self-perspective metadata

-- Maps
update appearances
set properties = coalesce(properties, '{}'::jsonb)
  || jsonb_build_object('groundingRegime', 'analytic', 'analyticForm', 'map')
where naming_id = perspective_id
  and mode = 'perspective'
  and properties ? 'mapType';

-- Phases
update appearances
set properties = coalesce(properties, '{}'::jsonb)
  || jsonb_build_object('groundingRegime', 'analytic', 'analyticForm', 'phase')
where naming_id = perspective_id
  and mode = 'perspective'
  and properties->>'role' = 'phase';

-- Infrastructure
update appearances
set properties = coalesce(properties, '{}'::jsonb)
  || jsonb_build_object('groundingRegime', 'infrastructural')
where naming_id = perspective_id
  and mode = 'perspective'
  and properties->>'role' in ('grounding-workspace', 'memo-system', 'docnet');

-- Positional axes will likely need a targeted backfill query once their
-- creation path is finalized.

-- ---------------------------------------------------------------------------
-- 028_phase_eligibility_constraints.sql
-- ---------------------------------------------------------------------------

create or replace function tqda_assert_phase_membership_allowed(
  p_phase_id uuid,
  p_naming_id uuid
)
returns void
language plpgsql
as $$
begin
  if tqda_analytic_form(p_phase_id) <> 'phase' then
    raise exception 'Phase membership target % is not a phase', p_phase_id;
  end if;

  if not tqda_phase_eligible(p_naming_id) then
    raise exception 'Naming % is not phase-eligible', p_naming_id;
  end if;
end;
$$;

create or replace function tqda_phase_membership_history_guard()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'assign' then
    perform tqda_assert_phase_membership_allowed(new.phase_id, new.naming_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tqda_phase_membership_history_guard on phase_memberships;
create trigger trg_tqda_phase_membership_history_guard
before insert on phase_memberships
for each row
execute function tqda_phase_membership_history_guard();

create or replace function tqda_phase_appearance_guard()
returns trigger
language plpgsql
as $$
begin
  if new.naming_id <> new.perspective_id
     and tqda_analytic_form(new.perspective_id) = 'phase' then
    perform tqda_assert_phase_membership_allowed(new.perspective_id, new.naming_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tqda_phase_appearance_guard on appearances;
create trigger trg_tqda_phase_appearance_guard
before insert or update on appearances
for each row
execute function tqda_phase_appearance_guard();

-- ---------------------------------------------------------------------------
-- Query fallback examples
-- ---------------------------------------------------------------------------

-- Prefer analyticForm='phase', but remain compatible with existing role='phase'
-- during migration:
--
--   where coalesce(a.properties->>'analyticForm',
--                  case when a.properties->>'role' = 'phase' then 'phase' end) = 'phase'

-- ---------------------------------------------------------------------------
-- Audit queries
-- ---------------------------------------------------------------------------

-- 1. Current invalid phase memberships
select a.perspective_id as phase_id, a.naming_id as member_id
from appearances a
where a.naming_id <> a.perspective_id
  and tqda_analytic_form(a.perspective_id) = 'phase'
  and not tqda_phase_eligible(a.naming_id);

-- 2. Analytic namings currently treated like empirical members
select n.id, n.inscription, tqda_grounding_regime(n.id) as grounding_regime, tqda_analytic_form(n.id) as analytic_form
from namings n
where exists (
  select 1
  from appearances a
  where a.naming_id = n.id
    and a.naming_id <> a.perspective_id
    and tqda_analytic_form(a.perspective_id) = 'phase'
)
and tqda_grounding_regime(n.id) <> 'empirical';

-- 3. Namings appearing in positional and non-positional analytical spaces
select distinct n.id, n.inscription
from namings n
where exists (
  select 1
  from appearances a
  join appearances m on m.naming_id = a.perspective_id
                    and m.perspective_id = a.perspective_id
                    and m.mode = 'perspective'
  where a.naming_id = n.id
    and m.properties->>'mapType' = 'positional'
)
and exists (
  select 1
  from appearances a
  join appearances m on m.naming_id = a.perspective_id
                    and m.perspective_id = a.perspective_id
                    and m.mode = 'perspective'
  where a.naming_id = n.id
    and m.properties->>'mapType' in ('situational', 'social-worlds', 'network')
);

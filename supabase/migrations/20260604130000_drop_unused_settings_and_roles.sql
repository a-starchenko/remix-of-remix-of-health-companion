-- Remove dead scaffolding carried over from the starter that no part of the app uses.
--
-- 1. user_settings — its enhance_prompt_template column only fed the removed
--    `enhance-prompt` edge function, and no frontend code reads any column
--    (no `.from("user_settings")` anywhere).
-- 2. The whole RBAC layer (app_role enum, user_roles table, has_role()) — there
--    is no admin UI, route, or hook; the only consumer was an admin branch in
--    the profiles SELECT policy, which we revert to strictly self-scoped.

-- --- user_settings ---------------------------------------------------------
-- DROP TABLE also removes the table's RLS policies and updated_at trigger.
DROP TABLE IF EXISTS public.user_settings;

-- --- profiles policy: drop the has_role() dependency before dropping the fn --
DROP POLICY IF EXISTS "Users can view own profile or admins can view all" ON public.profiles;

CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = user_id);

-- --- RBAC ------------------------------------------------------------------
-- DROP TABLE removes the user_roles RLS policies that referenced has_role().
DROP TABLE IF EXISTS public.user_roles;

-- has_role() now has no dependents.
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- app_role is no longer referenced by any table column or function.
DROP TYPE IF EXISTS public.app_role;

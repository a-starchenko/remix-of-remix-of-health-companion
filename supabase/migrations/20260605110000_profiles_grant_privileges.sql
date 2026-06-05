-- profiles was created before this project's convention of explicitly granting
-- table privileges. Without these grants the `authenticated` role can read its
-- own profile but UPDATE fails with "permission denied for table profiles",
-- so users cannot change their display name. Align it with the other tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

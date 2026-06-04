# Skill: Supabase Auth — SPA pattern with `@supabase/supabase-js`

> This skill documents the authentication architecture used in this project (Vite + React + React Router SPA). Because there is no SSR or server middleware, we rely on client-side session management via Supabase JS and a `ProtectedRoute` React component instead of Next.js `middleware.ts` or `@supabase/ssr`.

---

## Stack

| Concern | Solution |
|---------|----------|
| Auth provider | Supabase Auth (email/password) |
| Client library | `@supabase/supabase-js` v2 |
| Session storage | `localStorage` (persisted, auto-refreshed) |
| Route protection | `ProtectedRoute` React component (wraps React Router `<Route>`) |
| Framework | Vite + React 18 + React Router v6 |

---

## Routes

| Path | Component | Access |
|------|-----------|--------|
| `/sign-in` | `SignInPage` | Public |
| `/sign-up` | `SignUpPage` | Public |
| `/forgot-password` | `ForgotPasswordPage` | Public |
| `/reset-password` | `ResetPassword` | Public (requires recovery token in URL hash) |
| `/auth` | — | Redirects → `/sign-in` (legacy compat) |
| `/chat` | `ChatView` | Protected |
| `/settings` | `SettingsPage` | Protected |
| `/knowledge-base` | `KnowledgeBasePage` | Protected |
| `/admin` | `AdminView` | Protected |

---

## Supabase client setup

**`src/integrations/supabase/client.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
```

Only the **anon/publishable key** is used client-side. The **service-role key** lives only in Edge Function environment variables (`SUPABASE_SERVICE_ROLE_KEY`) and is never exposed to the browser.

---

## `useAuth` hook

**`src/hooks/useAuth.tsx`** — single source of truth for auth state.

```ts
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session); setUser(session?.user ?? null); setLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setUser(session?.user ?? null); setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); };
  return { user, session, loading, signOut };
}
```

---

## ProtectedRoute pattern

**`src/components/auth/ProtectedRoute.tsx`** — equivalent of Next.js middleware for SPAs.

```tsx
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/sign-in" state={{ from: location }} replace />;
  return <>{children}</>;
};
```

Usage in `App.tsx`:

```tsx
<Route path="/chat" element={<ProtectedRoute><ChatView /></ProtectedRoute>} />
```

After sign-in, `SignInPage` reads `location.state.from.pathname` and redirects back to the original page:

```ts
const from = (location.state as { from?: Location })?.from?.pathname ?? '/chat';
// after successful signInWithPassword → navigate(from, { replace: true })
```

---

## Sign-in flow

1. User visits protected route → `ProtectedRoute` redirects to `/sign-in?from=<path>`
2. User submits email + password → `supabase.auth.signInWithPassword()`
3. On success: `onAuthStateChange` fires → `navigate(from, { replace: true })`
4. Session stored in `localStorage`; auto-refreshed via `autoRefreshToken: true`

---

## Sign-up flow

1. `supabase.auth.signUp({ email, password, options: { emailRedirectTo, data: { display_name } } })`
2. Supabase sends confirmation email; on click, session is established
3. A trigger (`handle_new_user`) on `auth.users` inserts a row into `public.profiles`

---

## Forgot-password / reset flow

1. **`/forgot-password`** → `supabase.auth.resetPasswordForEmail(email, { redirectTo: '/reset-password' })`
2. User clicks link in email → lands on `/reset-password` with `#type=recovery` hash
3. **`/reset-password`** reads hash, sets `isRecovery = true`, shows new-password form
4. `supabase.auth.updateUser({ password })` → success → navigate to `/chat`

---

## Sign-out

```ts
// UserDropdown.tsx
const handleSignOut = async () => {
  sessionStorage.removeItem('impersonating');
  await signOut();           // supabase.auth.signOut()
  navigate('/sign-in');
};
```

---

## Reading the authenticated user in Edge Functions

Edge Functions receive the `Authorization: Bearer <access_token>` header from the client:

```ts
// supabase/functions/chat/index.ts
const authHeader = req.headers.get('Authorization');
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: authHeader } },
});
const { data: { user } } = await supabase.auth.getUser();
```

Never use the service-role key to authenticate users — only to bypass RLS for admin operations.

---

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_SUPABASE_URL` | Client | Supabase project base URL (must be `https://<ref>.supabase.co`, not `/rest/v1/`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client | Anon/public JWT — safe to expose |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | Bypasses RLS — never expose client-side |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Edge Functions | Injected automatically by Supabase runtime |

---

## Test account

`test@email.com` / `password` — must exist in Supabase Auth. Create it via:

```bash
supabase auth admin create-user --email test@email.com --password password
```

Or manually: Supabase Dashboard → **Authentication → Users → Add user → Create new user**.

> Use this account for **sign-in testing only** — do not attempt to sign up with it.

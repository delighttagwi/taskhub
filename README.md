# APP SURVEY

APP SURVEY is a Next.js web app with email-and-password authentication, USDT-denominated rewards and withdrawals, member and admin portals, private screenshot submissions, a funded rewards ledger, and admin-promoted private messaging. Mobile numbers remain required contact details on signup.

## Requirements

- Node.js 20.9 or newer and npm
- A Supabase project with email authentication enabled
- A deployment target that supports Next.js route handlers and streaming responses for live chat updates

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the Supabase project URL, anon key, and service-role key.
3. Keep all three variables server-only. Do not add a `NEXT_PUBLIC_` prefix, commit `.env.local`, or paste the service-role key into a browser or SQL editor.
4. In Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql).
5. In Supabase Dashboard > Authentication settings, enable the Email provider. Signup uses the server-only Admin API to mark the supplied email confirmed and create a session immediately, so no confirmation email is sent. The email address is not verified as belonging to the registrant. The mobile number remains a required contact field and is not used for authentication.
6. Because the original schema may already be installed, run [`supabase/migrations/20261123_email_password_auth.sql`](supabase/migrations/20261123_email_password_auth.sql) in Supabase SQL Editor to add email to existing profiles and update the auth trigger.
7. Start the website with `npm run dev`, then open `http://localhost:3000`.

Supabase database and storage requests are made by the Next.js server. The browser only connects to this website's `/api` endpoints, including for realtime chat events. The Supabase URL and keys are not in the client bundle. The server still needs the URL and keys in its deployment environment.

## Create the first admin

Register the email address that should own the initial admin account. Then run this in Supabase SQL Editor, replacing the phone number with its exact E.164 value:

```sql
update public.profiles
set role = 'admin'
where phone = '+919876543210';
```

This should be done by the project owner through the trusted Supabase dashboard, not exposed as a website feature. Sign out and sign back in after changing the role.

## Fund rewards

Before approving any task rewards, an administrator must record available platform/client funding in Admin > Rewards > Record platform funding. This is a back-office record of money already received, not a user deposit. The database refuses reward approvals that exceed recorded available funding. Do not advertise earnings unless task terms and funding are real and available.

Set the default task reward, daily approved-task limit, and minimum withdrawal in Admin > Rewards. A task's reward is fixed when the task is created. Daily limits are enforced at approval time. Every approved reward and withdrawal hold/refund is recorded in `transactions`; balances are derived from that ledger, not directly edited.

## Deployment

1. Push the project to a private or public Git repository and import it into Vercel (or another Next.js host).
2. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as server environment variables for Preview and Production. Do not expose the service-role key to client-side code.
3. Deploy, configure the site domain, and set Supabase Auth's allowed site URL.
4. Verify email/password signup, login and contact-phone storage, screenshot upload, admin approval, withdrawal reserve/refund, funding limits, account suspension, chat promotion/revocation, and realtime messaging in the deployed environment.

## Important operational notes

- Screenshots are private, size/type limited, and shown to admins through short-lived signed URLs.
- Admin access is determined by the `profiles.role` database value. There is no public admin signup or role promotion endpoint.
- The service-role key bypasses Row Level Security, so it must remain on the server. API handlers check the session and role before using it.
- Public registration uses that server-only Admin API and has a basic per-process signup throttle. Add persistent rate limiting and CAPTCHA before a public production launch; the email is treated as confirmed without proving ownership.
- All displayed monetary values are denominated in USDT. Configure payout instructions for the chosen wallet provider and network before enabling withdrawals.
- Use HTTPS, enable Supabase Auth abuse protections, and review your jurisdiction's privacy, consumer, app-testing, and payout requirements before launch.
- Realtime chat requires Supabase Realtime to be available for the `messages` table. Some hosting plans may limit long-lived streaming connections; test the target host before launch.
- The project has not been deployed or connected to a Supabase account from this workspace.

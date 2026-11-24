# APP SURVEY

APP SURVEY is a Next.js web app with email-and-password authentication, point-denominated task rewards, USDT cash-outs, member and admin portals, private screenshot submissions, an audited wallet ledger, and admin-promoted private messaging. Mobile numbers remain required contact details on signup.

The site includes a PWA manifest, install icon, service worker, and an install button. Install prompts are browser-controlled and appear only when supported; on iOS, use Share > Add to Home Screen. Install features require HTTPS or localhost.

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
7. Run [`supabase/migrations/20261124_app_surveys_usdt_rewards.sql`](supabase/migrations/20261124_app_surveys_usdt_rewards.sql) in Supabase SQL Editor to add task survey questions/answers and the admin-selected approval reward RPC.
8. Run [`supabase/migrations/20261124_points_wallet_and_cashout.sql`](supabase/migrations/20261124_points_wallet_and_cashout.sql) to store wallet credits in points and convert them to USDT only at cash-out.
9. In Admin > Rewards, set the points required per 1 USDT. It defaults to unset, so withdrawals remain unavailable until the admin chooses a rate.
10. Start the website with `npm run dev`, then open `http://localhost:3000`.

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

The admin reviews the required app survey and chooses the points to credit; point awards are recorded in the immutable transaction ledger and are not blocked by the payout funding log. In Admin > Rewards, configure the points-per-USDT rate and minimum withdrawal (USDT). At cash-out, the rate is captured with the request and the corresponding points are held. An admin must approve the USDT payout; the funding log must cover approved payouts. Rejected payouts return the held points. Daily approved-task limits still apply. Registration remains free; never require users to deposit money to unlock tasks or rewards.

Set the default task reward in points, daily approved-task limit, points-per-USDT rate, and minimum withdrawal in Admin > Rewards. The admin may adjust the point award during review. Daily limits are enforced at approval time. Every point award and withdrawal hold/refund is recorded in `transactions`; balances are derived from that ledger, not directly edited.

## Deployment

1. Push the project to a private or public Git repository and import it into Vercel (or another Next.js host).
2. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as server environment variables for Preview and Production. Do not expose the service-role key to client-side code.
3. Deploy, configure the site domain, and set Supabase Auth's allowed site URL.
4. Verify email/password signup, login and contact-phone storage, screenshot upload, survey answers, virtual reward crediting, withdrawal reserve/refund and approval, account suspension, chat promotion/revocation, and realtime messaging in the deployed environment.

## Important operational notes

- Screenshots are private, size/type limited, and shown to admins through short-lived signed URLs.
- Admin access is determined by the `profiles.role` database value. There is no public admin signup or role promotion endpoint.
- The service-role key bypasses Row Level Security, so it must remain on the server. API handlers check the session and role before using it.
- Public registration uses that server-only Admin API and has a basic per-process signup throttle. Add persistent rate limiting and CAPTCHA before a public production launch; the email is treated as confirmed without proving ownership.
- Task rewards and wallet balances are points; withdrawal requests and platform funding are denominated in USDT. Configure and verify the conversion rate and payout network before enabling withdrawals.
- Use HTTPS, enable Supabase Auth abuse protections, and review your jurisdiction's privacy, consumer, app-testing, and payout requirements before launch.
- Realtime chat requires Supabase Realtime to be available for the `messages` table. Some hosting plans may limit long-lived streaming connections; test the target host before launch.
- The project has not been deployed or connected to a Supabase account from this workspace.

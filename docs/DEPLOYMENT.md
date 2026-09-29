# Deploy EinsteinAI with Vercel and Render

This guide prepares the React frontend and FastAPI backend for a first public deployment. The web client and API run as separate services. Supabase remains the authentication and database provider, and Gemini calls are made by the backend.

## Deployment topology

```text
Browser -> Vercel React site -> Render FastAPI API -> Gemini
    |                            |
    +------ Supabase Auth and Postgres ------+
```

The frontend needs the public Supabase project URL and publishable key plus the deployed API URL. The backend needs the Gemini key, Supabase URL, publishable key, service-role key, and exact frontend origin for CORS.

## Before starting

- Apply the Supabase SQL setup to the intended project.
- Confirm sign-in, chat, and saved conversation history work locally.
- Have the Gemini and Supabase keys ready to enter in host dashboards. Do not add real values to `.env.example`, `render.yaml`, or committed source.
- Confirm the GitHub repository contains the code you intend to publish. The production branch is `main`.
- The Render Blueprint is explicitly configured for its Free plan. Render Free web services spin down after 15 minutes without requests and can take about a minute to wake up. Render describes Free instances as suited to testing, hobby projects, and previews rather than production. See [Render Free plan limitations](https://render.com/docs/free).

## 1. Deploy the backend on Render

The root [`render.yaml`](../render.yaml) defines a Python web service rooted at `backend/`, installs `requirements.txt`, starts Uvicorn on Render's assigned port, and uses `/health` as its health check. Render documents this FastAPI start pattern in its [FastAPI deployment guide](https://render.com/docs/deploy-fastapi) and the blueprint format in its [Blueprint specification](https://render.com/docs/blueprint-spec).

1. Push the reviewed deployment files to the GitHub `main` branch.
2. In Render, choose **New +** → **Blueprint** and connect the EinsteinAI GitHub repository.
3. Review the service name and confirm the Free plan before creating it.
4. Enter these values when Render requests environment variables:

   | Variable | Value |
   |---|---|
   | `GEMINI_API_KEY` | Your Google Gemini API key. |
   | `SUPABASE_URL` | The URL of the Supabase project used by the app. |
   | `SUPABASE_PUBLISHABLE_KEY` | Publishable key from that same project. |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service-role/secret key from that same project. Backend only. |
   | `CORS_ORIGINS` | Keep the local values for the first deploy; replace them with the Vercel production origin after step 2. |

5. Wait for the deploy to finish and copy the API URL, for example `https://einsteinai-api.onrender.com`.
6. Open `https://<your-render-host>/health`. It should return `{"status":"ok"}`.

Do not commit actual secrets or put them in Vite variables. The Blueprint uses `sync: false` for secrets so they are entered in Render's dashboard. See [Render environment variables and secrets](https://render.com/docs/configure-environment-variables).

## 2. Deploy the frontend on Vercel

The Vite app is in `frontend/`. Its [`vercel.json`](../frontend/vercel.json) routes browser paths back to `index.html`, the SPA fallback described in [Vercel's Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite).

1. In Vercel, import the EinsteinAI repository from GitHub.
2. Set **Root Directory** to `frontend`.
3. Use the Vite defaults, or confirm:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add these production environment variables:

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Same Supabase project URL as the backend. |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Same Supabase publishable key as the backend. |
   | `VITE_API_URL` | The Render API URL from step 1, with no trailing slash. |

5. Deploy and copy the production site origin, for example `https://einstein-ai.vercel.app`.

Only publishable values belong in Vercel. Every `VITE_*` variable is delivered to the browser. Never add `GEMINI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` to Vercel.

## 3. Set backend CORS

In Render, open the `einsteinai-api` service's **Environment** page and change `CORS_ORIGINS` to the exact Vercel origin, for example:

```text
https://einstein-ai.vercel.app
```

Do not include a path or trailing slash. If you use a custom domain, add that exact origin too. Save the change and let Render redeploy. Preview deployments can have different origins; do not use broad wildcard origins for this authenticated app.

## 4. Set Supabase Auth URLs

In Supabase Dashboard → **Authentication** → **URL Configuration**:

- Set **Site URL** to the Vercel production origin.
- Add the production origin as an allowed redirect URL. Keep localhost redirect URLs for development if needed.
- If you use a custom domain, add it to both settings.

This directs sign-in, confirmation, and recovery links back to the deployed app. Set email confirmation according to how you want account creation to work.

## 5. Verify the live app

1. The Vercel homepage opens over HTTPS.
2. Reloading the home page directly works (SPA fallback).
3. The Render `/health` endpoint returns `status: ok`.
4. Sign up or sign in and confirm Auth returns to Vercel.
5. Send a physics question; confirm the browser has no CORS error and Render logs show a successful `/api/chat` request.
6. Confirm conversations persist after refreshing and are private to the owning account.
7. Check usage and subscription behavior against the intended Supabase project.
8. Review Render logs for errors. Do not share logs containing secrets, access tokens, or private conversations.

## Updating after launch

With GitHub auto-deploy enabled, pushes to `main` rebuild the configured services. Review build logs after each deploy. If a deploy fails, revert the change in GitHub or use the host's rollback controls, then check `/health` and the main sign-in/chat flow again.

## Production limitations and security

- Render Free sleeps after 15 minutes idle; the first request after sleep may wait about a minute. Upgrade only if you need the API to remain warm.
- No payment processing is implemented. Plans remain manually administered in Supabase.
- Keep Gemini and Supabase service-role secrets in Render only. Rotate them if committed or shared.
- Restrict CORS to the Vercel/custom production origin.
- Enable and review Supabase RLS for every user-owned table. Do not rely on UI hiding for data protection.
- Consider rate limiting, abuse monitoring, data retention/backups, and email confirmation before broad public access.

## Official hosting references

- [Vercel: Vite deployment and SPA routing](https://vercel.com/docs/frameworks/frontend/vite)
- [Render: Deploy a FastAPI app](https://render.com/docs/deploy-fastapi)
- [Render: Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render: Free service limitations](https://render.com/docs/free)
- [Render: Environment variables and secrets](https://render.com/docs/configure-environment-variables)

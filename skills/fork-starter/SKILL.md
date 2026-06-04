---
name: Fork Starter
description: Remix a Lovable starter project into your own account and connect it to a fresh GitHub repository so push-to-deploy works.
---

# Skill: Fork Starter

Steps to remix a Lovable project and connect it to a fresh GitHub repository.

## 1. Remix the Lovable project

1. Open the source project on `lovable.dev` (e.g. `lovable.dev/projects/<id>`).
2. Click **"Remix this project"** — this forks it into your own Lovable account.
3. Give the new project a name.

## 2. Connect to GitHub

1. In the Lovable editor go to **Settings → GitHub**.
2. Click **"Connect to GitHub"** and authorise the Lovable GitHub app.
3. Choose **"Create new repository"**, set visibility (public/private), confirm.
4. Lovable pushes the initial commit automatically.

## 3. Clone and verify locally

```sh
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>
npm install
npm run dev
```

The dev server should start at `http://localhost:8080` with no errors.

## 4. Harden .gitignore

Make sure the following are excluded before any further commits:

```
.env
.env.local
.env.*.local
```

If `.env` was already committed, remove it from tracking:

```sh
git rm --cached .env
git commit -m "chore: remove .env from tracking"
```

## 5. Add .env.example

Create `.env.example` listing all required variable names with empty values. This file **is** committed — it documents what developers need to fill in without exposing any secrets.

## 6. Update README.md

Replace the generic Lovable template with:
- Project description
- Local setup steps (clone → install → copy `.env.example` → `npm run dev`)
- Table of all env vars with descriptions
- Stack overview

## Checklist

- [ ] Project remixed on Lovable
- [ ] Repo created and code pushed to GitHub
- [ ] `.env` excluded in `.gitignore` and removed from git tracking if needed
- [ ] `.env.example` committed with variable names (no values)
- [ ] `README.md` updated with setup instructions and env var table
- [ ] No secrets in any committed file

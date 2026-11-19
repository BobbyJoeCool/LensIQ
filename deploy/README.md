# Deploying LensIQ

LensIQ runs as one Docker container behind a Cloudflare Tunnel, with Cloudflare Access in front. Each step is tagged with where it runs:

- **[BROWSER]**: Notion, Cloudflare or GitHub in a web browser
- **[MACSERVER]**: a shell on the server, after `ssh macserver`
- **[JANEWAY]**: the development laptop

Do the steps in order the first time. After that, deploying is one line ([step 7](#7-everyday-deploys)).

## 1. Create the Notion integration (once)

**[BROWSER]**

1. Go to <https://www.notion.so/profile/integrations> and choose **New integration**.
2. Name it `LensIQ`, pick the workspace, and set the type to **Internal**.
3. Under **Capabilities**, turn on **Read content**, **Update content** and **Insert content** (editing arrives in Phase 2). Leave user information off.
4. Save, then copy the **Internal Integration Secret**. It goes in `.env` in step 3. Don't paste it anywhere else.
5. In Notion, open the **Job Search Tracker** database and choose **··· → Connections → LensIQ**. Share only the databases LensIQ should see.

## 2. Clone the repo on the server (once)

**[MACSERVER]**

```bash
mkdir -p ~/src
git clone https://github.com/BobbyJoeCool/LensIQ.git ~/src/lensiq
```

## 3. Create the app folder, secrets and compose file (once)

**[MACSERVER]** Replace `PASTE_NOTION_SECRET` with the secret from step 1. Leave the two `CF_ACCESS_` values blank for now; you'll fill them in step 5.

```bash
mkdir -p ~/apps/lensiq/data
cd ~/apps/lensiq
umask 077
cat > .env <<'EOF'
NOTION_TOKEN=PASTE_NOTION_SECRET
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUD=
EOF
cp ~/src/lensiq/deploy/compose.yaml ~/apps/lensiq/compose.yaml
cp ~/src/lensiq/deploy/deploy.sh ~/apps/lensiq/deploy.sh
chmod +x ~/apps/lensiq/deploy.sh
```

Create `data/` before the first start (as above). If Docker creates it, the folder is owned by root and the container (user `node`) can't write the SQLite file.

## 4. Publish the route (once)

**[BROWSER]** In Cloudflare Zero Trust, open **Networks → Tunnels → macserver → Published application routes** and add a route:

| Field | Value |
| --- | --- |
| Subdomain | `lensiq` |
| Domain | `bobbyjoecool.dev` |
| Type | HTTP |
| URL | `lensiq-app-1:3000` |

If a DNS record named `lensiq` already exists, delete it on the DNS page first.

## 5. Put Cloudflare Access in front (once)

**[BROWSER]** One-time PIN is an identity provider that has to exist on the account first. In Cloudflare Zero Trust, open **Integrations → Identity providers**. If **One-time PIN** isn't listed under **Your identity providers**, choose **Add new identity provider → One-time PIN**.

Then open **Access controls → Applications → Create new application → Self-hosted and private**:

1. **Add public hostname**: subdomain `lensiq`, domain `bobbyjoecool.dev`.
2. **Access policies → Create new policy**: Action **Allow**, Include rule **Emails**, listing only the addresses that should get in. Attach it to the application. (Don't use Include **Login methods → One-time PIN**: Include rules are OR'd, so that admits anyone with an email address.)
3. **Identity providers**: turn off **Accept all available identity providers** and select only **One-time PIN**.
4. **Create**. Then choose **Edit** on the application, open **Additional settings**, and copy the **Application Audience (AUD) Tag**.
5. The team domain is in the address bar of the login page (`https://<team>.cloudflareaccess.com/...`) or under **Settings → Team name and domain**, e.g. `yourteam.cloudflareaccess.com`.

**[MACSERVER]** Put both values into `.env`, replacing the placeholders:

```bash
cd ~/apps/lensiq
sed -i 's|^CF_ACCESS_TEAM_DOMAIN=.*|CF_ACCESS_TEAM_DOMAIN=PASTE_TEAM_DOMAIN|' .env
sed -i 's|^CF_ACCESS_AUD=.*|CF_ACCESS_AUD=PASTE_AUD_TAG|' .env
```

Without both values the container refuses to start. This is deliberate: the API checks the Access token on every `/api` request, so a request that skips Cloudflare (for example from another container on the `web` network) is rejected.

## 6. First build and start

**[MACSERVER]**

```bash
~/apps/lensiq/deploy.sh
```

Then check it from inside the server:

```bash
docker run --rm --network web curlimages/curl -s http://lensiq-app-1:3000/api/health
```

You should see `{"ok":true}`. Then open <https://lensiq.bobbyjoecool.dev> on your phone, sign in with the one-time PIN, and paste the Job Search Tracker link into **Add database**.

## 7. Everyday deploys

**[JANEWAY]**

```bash
git push
ssh macserver '~/apps/lensiq/deploy.sh'
```

Success looks like `lensiq-app-1` showing `Up (healthy)` in the `docker compose ps` output the script prints.

## 8. Registry and backups (once)

**[MACSERVER]** SQLite isn't covered by the nightly Postgres dumps. In `~/backup.sh`, add this line before the `find` cleanup line:

```bash
tar -czf "$BACKUP_DIR/lensiq-files-$(date +%F).tar.gz" -C /home/bobbyjoecool/apps/lensiq data
```

Make sure the cleanup line matches `\( -name '*.dump' -o -name '*.tar.gz' \)` so old archives are also removed after 14 days. Test it:

```bash
~/backup.sh && ls -lh ~/backups | grep lensiq
```

Add LensIQ to the server registry in the MacServer setup guide:

| App folder | Public hostname | Container:port for route | DB local port | Notes |
| --- | --- | --- | --- | --- |
| `lensiq` | `lensiq.bobbyjoecool.dev` | `lensiq-app-1:3000` | none | SQLite in `data/`, backed up via tar |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Container restarts; logs say `LensIQ can't start: Missing required environment variables` | Fill in the named values in `~/apps/lensiq/.env`, then `cd ~/apps/lensiq && docker compose up -d --force-recreate app`. |
| Every page shows `Missing/Invalid Cloudflare Access token` | The Access app isn't in front of the hostname, or `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN` don't match it. |
| "Notion couldn't find that database" | Share the database with the LensIQ connection (··· → Connections). |
| `SQLITE_CANTOPEN` or permission errors | The container runs as uid 1000 (`node`). Make `data/` writable by it: `sudo chown -R 1000:1000 ~/apps/lensiq/data`. |
| Cloudflare 502 / 1033 | The route must be exactly `lensiq-app-1:3000`, and the container must be on the `web` network. |
| Adding a database says "Something went wrong on the server"; logs show `invalid authorization header` | `NOTION_TOKEN` in `.env` contains stray characters, often terminal bracketed-paste markers (`ESC[200~`) or a trailing `\r`. Rewrite it: run `printf '\e[?2004l'`, then `read -rs T`, then strip control characters with `tr -d '\000-\037\177 '`, write the line back, and recreate the container. |
| `exec format error` | The image was built for ARM. Build on the server, or on Janeway use `--platform linux/amd64`. |

Logs: **[MACSERVER]** `cd ~/apps/lensiq && docker compose logs --tail 50 app`

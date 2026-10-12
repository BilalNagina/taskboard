# Single-Server Deployment: Runbook

## First-time setup

Prerequisites: an AWS account, Terraform ≥ 1.6, a domain whose DNS you control, and this repository on GitHub.

### 1. Create a deploy key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/taskboard -C taskboard-deploy -N ""
```

### 2. Provision the server, backup bucket and budget alert

```bash
cd deploy/single-server/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in region, bucket name, email
terraform init
terraform apply
```

Note the outputs: `static_ip`, `ssh_command`, `backup_bucket`, `backup_access_key_id`. Read the secret key with `terraform output -raw backup_secret_access_key`.

### 3. Point DNS at the server

Create an **A record** for your hostname (e.g. `taskboard.example.com`) → `static_ip`. Check it with `nslookup taskboard.example.com`.

### 4. Wait for first-boot setup, then create the server's `.env`

```bash
ssh -i ~/.ssh/taskboard ubuntu@<static_ip>
cloud-init status --wait          # bootstrap-server.sh finishes (Docker, firewall, swap, cron)
nano /opt/taskboard/.env          # contents: deploy/single-server/.env.example
```

Generate the database password with `openssl rand -hex 24`. Fill in the `BACKUP_*` values from the Terraform outputs.

### 5. Configure GitHub

Settings → Secrets and variables → Actions:

| Type | Name | Value |
|---|---|---|
| Secret | `SSH_HOST` | the static IP |
| Secret | `SSH_PRIVATE_KEY` | contents of `~/.ssh/taskboard` |
| Secret | `SSH_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <static_ip>` |
| Variable | `DOMAIN` | `taskboard.example.com` |

Also create an environment called `production` (Settings → Environments). Add required reviewers if you want manual approval before each deploy.

### 6. First deploy

Actions → **Deploy (single server)** → Run workflow → tick **Skip the HTTPS check** (there's no certificate yet).

### 7. Issue the HTTPS certificate

```bash
ssh -i ~/.ssh/taskboard ubuntu@<static_ip>
sudo certbot certonly --webroot -w /var/www/certbot \
  -d taskboard.example.com -m you@example.com --agree-tos --no-eff-email \
  --deploy-hook "cd /opt/taskboard && docker compose restart proxy"
cd /opt/taskboard && docker compose restart proxy
sudo certbot renew --dry-run      # confirms automatic renewal works
```

Open `https://taskboard.example.com`. The footer shows the deployed commit.

### 8. Prove backups work

```bash
/opt/taskboard/scripts/backup.sh
/opt/taskboard/scripts/restore.sh latest
```

From now on, a backup runs every night at 02:30 UTC (`/var/log/taskboard-backup.log`).

---

## Day-to-day operations

| Task | How |
|---|---|
| Deploy | Merge to `main`. CI runs tests, builds both images, deploys and checks HTTPS. |
| Roll back | Actions → open an older successful deploy run → **Re-run all jobs**. Or on the server: `/opt/taskboard/scripts/deploy.sh <commit-sha>` |
| Logs | `cd /opt/taskboard && docker compose logs -f api` (also `web`, `proxy`, `db`) |
| Status | `cd /opt/taskboard && docker compose ps` |
| Restore a backup | `/opt/taskboard/scripts/restore.sh latest` or `restore.sh taskboard-<timestamp>.sql.gz` |
| Check certificate renewal | `sudo certbot renew --dry-run` |
| Uptime alerts | A failed **Uptime check** run emails the repository owner |

### Rotate the database password

Changing `.env` alone doesn't change the password of an existing database user.

```bash
cd /opt/taskboard
NEW=$(openssl rand -hex 24)
docker compose exec -T db psql -U taskboard -d taskboard -c "ALTER USER taskboard PASSWORD '$NEW';"
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW/" .env
docker compose up -d api
```

### Rotate the backup key

`terraform apply -replace=aws_iam_access_key.backup`, then update `BACKUP_AWS_*` in `.env`.

---

## Teardown

1. Take the portfolio screenshots first (see the checklist in `docs/single-server/README.md`).
2. Clear the `DOMAIN` repository variable. This pauses the uptime check.
3. `cd deploy/single-server/terraform && terraform destroy`. This removes the server, static IP, backup bucket (including backups), IAM user and budget.
4. Delete the DNS A record.
5. Optional: delete the `taskboard-api` and `taskboard-web` packages under your GitHub profile → Packages.

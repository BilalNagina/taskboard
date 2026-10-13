# Single-Server Deployment: Runbook

## First-time setup

Prerequisites: an AWS account, Terraform ≥ 1.6, a domain whose DNS you control, and this repository on GitHub.

### 1. Create a deploy key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/taskboard -C taskboard-deploy -N ""
```

### 2. Provision the server, buckets, email domain and budget alert

```bash
cd deploy/single-server/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in region, bucket names, mail domain, email
terraform init
terraform apply
```

Note the outputs: `static_ip`, `ssh_command`, `backup_bucket`, `backup_access_key_id`, `attachments_bucket`, `app_access_key_id`, `smtp_host` and `dkim_records`. Read the secrets with `terraform output -raw backup_secret_access_key`, `terraform output -raw app_secret_access_key` and `terraform output -raw smtp_password`.

SES sends a verification email to each address in `mail_verified_recipients`. Click the link in it: while the account is in the SES sandbox, reminders are only delivered to verified addresses. Request production access in the SES console to email anyone.

### 3. Point DNS at the server

Create an **A record** for your hostname (e.g. `taskboard.example.com`) → `static_ip`. Check it with `nslookup taskboard.example.com`.

Add the three **CNAME records** from `dkim_records` too. SES verifies the mail domain once they resolve, usually within an hour. Many DNS providers want only the part before your root domain as the record name (e.g. `abc123._domainkey.taskboard`).

### 4. Wait for first-boot setup, then create the server's `.env`

```bash
ssh -i ~/.ssh/taskboard ubuntu@<static_ip>
cloud-init status --wait          # bootstrap-server.sh finishes (Docker, firewall, swap, cron)
nano /opt/taskboard/.env          # contents: deploy/single-server/.env.example
```

Generate the database password with `openssl rand -hex 24`. Fill in the `BACKUP_*`, `S3_*` and `SMTP_*` values from the Terraform outputs (`SMTP_USER` is the same key id as `S3_ACCESS_KEY_ID`).

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
  --deploy-hook "docker compose --project-directory /opt/taskboard restart proxy"
cd /opt/taskboard && docker compose restart proxy
sudo certbot renew --dry-run      # confirms automatic renewal works
```

certbot requires the deploy hook to start with an executable, so `cd /opt/taskboard && ...` is rejected; `--project-directory` does the same job. Non-interactive renewals wait a random 0–8 minutes before contacting Let's Encrypt, so a dry run can sit quietly for a few minutes.

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
| Logs | `cd /opt/taskboard && docker compose logs -f api` (also `worker`, `web`, `proxy`, `db`, `redis`) |
| Reminder emails | `docker compose logs worker`: each sent reminder logs `job completed` with `sent: true`. Failed sends retry 5 times with backoff, then log `job failed`. |
| Recover a deleted attachment | S3 console → attachments bucket → **Show versions** → restore the previous version of the object (kept 30 days). |
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

### Rotate the app key (S3 + SMTP)

`terraform apply -replace=aws_iam_access_key.app`, then update `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_USER` and `SMTP_PASS` in `.env` and run `docker compose up -d api worker`.

---

## Teardown

1. Take the portfolio screenshots first (see the checklist in `docs/single-server/README.md`).
2. Clear the `DOMAIN` repository variable. This pauses the uptime check.
3. `cd deploy/single-server/terraform && terraform destroy`. This removes the server, static IP, both buckets (including backups and attachments), the SES identities, both IAM users and the budget.
4. Delete the DNS A record and the three DKIM CNAME records.
5. Optional: delete the `taskboard-api` and `taskboard-web` packages under your GitHub profile → Packages.

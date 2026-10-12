# Single-Server Deployment

Handover pack for the single-server tier:

- [Architecture](architecture.md): what runs where, and why
- [Runbook](runbook.md): setup, deploys, rollbacks, restores, rotation, teardown
- [Cost](cost.md): monthly estimate and where to cut

## Portfolio screenshot checklist (before teardown)

- [ ] The sign-in page over HTTPS with the padlock
- [ ] A board with tasks, due-date badges and an attachment, footer showing the deployed commit
- [ ] A reminder email in the inbox
- [ ] A green **Deploy (single server)** run: CI → images → deploy → HTTPS check
- [ ] A rollback: a deliberately broken commit, the failed health check, and the automatic rollback in the log
- [ ] `docker compose ps` with all six containers healthy
- [ ] S3 bucket listing of nightly backups, plus terminal output of `restore.sh latest`
- [ ] A green **Uptime check** run
- [ ] `terraform apply` summary and outputs, with the account ID redacted

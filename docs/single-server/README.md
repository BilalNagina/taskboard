# Single-Server Deployment

Handover pack for the single-server tier:

- [Architecture](architecture.md): what runs where, and why
- [Runbook](runbook.md): setup, deploys, rollbacks, restores, rotation, teardown
- [Cost](cost.md): monthly estimate and where to cut

## Portfolio screenshot checklist (before teardown)

- [ ] The app over HTTPS with the padlock, footer showing the deployed commit
- [ ] A green **Deploy (single server)** run: CI → images → deploy → HTTPS check
- [ ] A rollback: a deliberately broken commit, the failed health check, and the automatic rollback in the log
- [ ] `docker compose ps` with all four containers healthy
- [ ] S3 bucket listing of nightly backups, plus terminal output of `restore.sh latest`
- [ ] A green **Uptime check** run
- [ ] `terraform apply` summary and outputs, with the account ID redacted

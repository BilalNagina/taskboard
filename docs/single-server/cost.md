# Single-Server Deployment: Cost

Estimates, not quotes. Check current AWS Lightsail and S3 pricing for your region.

| Item | Monthly | Notes |
|---|---|---|
| Lightsail instance (`small_3_0`: 2 vCPU, 2 GB RAM, 60 GB SSD) | ~$12 | Billed by the hour. Includes a data-transfer allowance. `micro_3_0` (1 GB, ~$7) works for very light traffic. |
| Lightsail static IP | $0 | Free while attached to an instance. Charged if left unattached, so `terraform destroy` removes it. |
| S3 backups | < $0.10 | A few MB of compressed dumps, 14-day retention |
| S3 attachments | < $0.10 | Per GB stored (~$0.024) plus requests. Old versions expire after 30 days. |
| Amazon SES | < $0.10 | $0.10 per 1,000 emails |
| Let's Encrypt certificate | $0 | |
| GitHub Actions + GHCR | $0 | Within free limits for a public repository |
| AWS Budget alert | $0 | The first budgets in an account are free |
| **Total** | **~$12** | |

## Where it can be cut

- `micro_3_0` instead of `small_3_0`: saves ~$5/month if memory use stays low (check with `docker stats`).
- Run it only when needed: a demo environment can be destroyed and recreated in about 15 minutes.

## When it stops being the cheapest option

Past the point where one VM is enough (high availability, zero-downtime deploys, a managed database), the AWS tier costs more per month but removes the single point of failure. See the AWS deployment's cost sheet.

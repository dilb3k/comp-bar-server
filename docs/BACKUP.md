# Bar-Backend Backup & Disaster Recovery

## Overview

This document describes the backup and disaster recovery strategy for the bar-backend MongoDB database used by Comp-Bar/Hisvex system (~100 admins).

## Backup Strategy

### Automated Daily Backups

- **Schedule**: Daily via cron (or Windows Task Scheduler)
- **Tool**: `mongodump` with `--gzip`
- **Storage**: S3-compatible bucket (separate region from primary DB)

### Cron Setup (Linux)

```
0 2 * * * /path/to/bar-backend/scripts/backup-mongo.sh "mongodb://..." "my-backup-bucket" 2>&1 | logger -t mongo-backup
```

### Task Scheduler Setup (Windows)

```
Trigger: Daily at 02:00
Action: powershell.exe -File C:\path\to\scripts\backup-mongo.ps1 -MongoUri "mongodb://..." -Bucket "my-backup-bucket"
```

## Retention Policy

| Backup Type | Retention | Location |
|-------------|-----------|----------|
| Daily dump | 30 days | S3 bucket |
| Monthly archive | 12 months | S3 Glacier |
| Yearly archive | 7 years | S3 Glacier Deep Archive |

## Recovery

### Restore from latest backup

```bash
# Download latest backup
aws s3 cp s3://my-bucket/backups/compbar_latest.tar.gz .

# Extract
tar -xzf compbar_latest.tar.gz

# Restore
mongorestore --uri="mongodb://..." --gzip compbar_*/compbar/
```

### RTO / RPO

- **RPO (Recovery Point Objective)**: <= 24 hours (daily backup)
- **RTO (Recovery Time Objective)**: <= 4 hours

## Testing

- **Monthly**: Restore drill on staging environment
- **Quarterly**: Full DR simulation including app startup verification

## Monitoring

- Backup script logs to stdout/stderr
- Failed backups reported via Telegram (existing bot channel)
- Health check endpoint: `GET /api/health` verifies DB connectivity

## Mongo Atlas (if applicable)

If using MongoDB Atlas:
- Enable Continuous Backup (PITR) for 7-day rolling window
- Configure cluster alert for backup failures
- Snapshots: https://cloud.mongodb.com > Clusters > Backup

## Important Notes

- Backups are compressed with gzip (~80% reduction)
- Never store backup credentials in the script - use environment variables or AWS IAM roles
- Test restore procedure at least once per month

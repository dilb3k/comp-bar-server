#!/bin/bash
set -euo pipefail

MONGO_URI="${1:?"Usage: $0 <mongo-uri> <s3-bucket> [aws-profile]"}
BUCKET="${2:?"Usage: $0 <mongo-uri> <s3-bucket> [aws-profile]"}
AWS_PROFILE="${3:-default}"
BACKUP_DIR="./backups"

TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
DUMP_DIR="${BACKUP_DIR}/compbar_${TIMESTAMP}"
ARCHIVE="${DUMP_DIR}.tar.gz"

echo "Starting MongoDB backup..."

mkdir -p "$BACKUP_DIR"

echo "Running mongodump..."
mongodump --uri="$MONGO_URI" --out="$DUMP_DIR" --gzip

echo "Compressing backup..."
tar -czf "$ARCHIVE" -C "$BACKUP_DIR" "compbar_${TIMESTAMP}"

echo "Uploading to S3..."
aws s3 cp "$ARCHIVE" "s3://${BUCKET}/backups/" --profile "$AWS_PROFILE"

echo "Cleaning up..."
rm -rf "$DUMP_DIR" "$ARCHIVE"

echo "Backup complete: s3://${BUCKET}/backups/compbar_${TIMESTAMP}.tar.gz"

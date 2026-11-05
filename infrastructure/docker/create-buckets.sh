#!/bin/sh
# Idempotently create the buckets listed in $BUCKETS on the local S3 endpoint.
set -u
for b in $BUCKETS; do
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if aws --endpoint-url http://storage:8333 s3api head-bucket --bucket "$b" 2>/dev/null; then
      echo "bucket $b ok"; break
    fi
    aws --endpoint-url http://storage:8333 s3 mb "s3://$b" && break
    sleep 2
  done
done

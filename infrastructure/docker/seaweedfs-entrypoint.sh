#!/bin/sh
# Writes the SeaweedFS S3 identity file from env, then starts an all-in-one server.
# Anonymous users may only read the public bucket.
set -eu
cat > /etc/s3.json <<JSON
{"identities":[
  {"name":"app","credentials":[{"accessKey":"${S3_ACCESS_KEY}","secretKey":"${S3_SECRET_KEY}"}],
   "actions":["Admin","Read","Write","List","Tagging"]},
  {"name":"anonymous","actions":["Read:${S3_BUCKET_PUBLIC}"]}
]}
JSON
exec weed server -dir=/data -ip.bind=0.0.0.0 -s3 -s3.port=8333 -s3.config=/etc/s3.json

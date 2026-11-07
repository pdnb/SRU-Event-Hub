# One-shot bucket creation with the script baked in (no bind mounts needed).
FROM amazon/aws-cli:2.39.4
COPY infrastructure/docker/create-buckets.sh /create-buckets.sh
ENTRYPOINT ["/bin/sh", "/create-buckets.sh"]

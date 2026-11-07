# SeaweedFS (S3) with the identity-writing entrypoint baked in (no bind mounts needed).
FROM chrislusf/seaweedfs:4.52
COPY infrastructure/docker/seaweedfs-entrypoint.sh /s3-entrypoint.sh
ENTRYPOINT ["/bin/sh", "/s3-entrypoint.sh"]

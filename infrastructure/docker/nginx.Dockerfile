# Reverse proxy with its config baked in (platforms such as Coolify cannot bind-mount repo files).
FROM nginx:1.29-alpine
ARG NGINX_CONF=default.conf
COPY infrastructure/nginx/${NGINX_CONF} /etc/nginx/conf.d/default.conf

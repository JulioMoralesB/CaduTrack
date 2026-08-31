# Stage 1: build the Vite app
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: serve the static build with nginx
FROM nginx:alpine

# The container's whole log stream is meant to be JSON (see nginx.conf). Two
# sources of plain text are not the access log and have to be silenced here.
#
# The entrypoint narrates its own startup in five lines of prose.
ENV NGINX_ENTRYPOINT_QUIET_LOGS=1

# nginx itself logs at notice, which is fourteen lines about worker processes
# on every start — and this container restarts nightly with the backup. `warn`
# keeps everything that reports a problem, including the upstream-resolution
# errors from the 2026-08-31 outage, and drops the startup banner.
#
# Patched in place rather than by replacing nginx.conf wholesale, so the rest
# of the base image's defaults keep tracking the upstream image. The grep is
# the point: if a future base image words this line differently the build
# fails here instead of silently going back to notice.
RUN grep -q "^error_log  *[^ ]*error\.log  *notice;" /etc/nginx/nginx.conf \
    && sed -i "s|^\(error_log  *[^ ]*error\.log  *\)notice;|\1warn;|" /etc/nginx/nginx.conf

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

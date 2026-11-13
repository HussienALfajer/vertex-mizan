# mizan.vertexmedia.pro: Vertex Mizan (ADR 0020, docs/deployment.md). Installed by
# deploy/provision.sh as /etc/nginx/sites-available/mizan.vertexmedia.pro; edit it in the
# repository, never on the server.
#
# nginx is the only public gateway: the SPA build is served from the current release, /api and
# Hub's /v1 are proxied to the API on loopback (127.0.0.1:3300).

server {
    listen 80;
    listen [::]:80;
    server_name mizan.vertexmedia.pro;
    access_log /var/log/nginx/mizan.vertexmedia.pro.access.log;
    error_log /var/log/nginx/mizan.vertexmedia.pro.error.log warn;
    location ^~ /.well-known/acme-challenge/ { root /var/www/mizan-acme; }
    location / { return 301 https://mizan.vertexmedia.pro$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name mizan.vertexmedia.pro;

    ssl_certificate /etc/letsencrypt/live/mizan.vertexmedia.pro/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mizan.vertexmedia.pro/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    access_log /var/log/nginx/mizan.vertexmedia.pro.access.log;
    error_log /var/log/nginx/mizan.vertexmedia.pro.error.log warn;

    root /srv/mizan.vertexmedia.pro/current/apps/web/dist;
    index index.html;

    # The API reads at most 256 KB of JSON (apps/api BODY_LIMIT); the routes that take more raise
    # this for themselves only.
    client_max_body_size 1m;
    client_body_timeout 20s;
    server_tokens off;

    limit_conn perip 100;
    limit_req zone=mizangeneral burst=50 nodelay;
    # The web app and Hub can retry a 429; a 503 reads as the server being down.
    limit_req_status 429;
    limit_conn_status 429;

    include snippets/mizan-headers.conf;

    gzip on;
    gzip_vary on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # --- API -----------------------------------------------------------------------------
    location /api/ {
        proxy_pass http://127.0.0.1:3300;
        include snippets/mizan-proxy.conf;
    }

    # Password guessing and anonymous email: sign-in and its second factor, the password reset,
    # re-authentication, and an invitation's lookup and acceptance get the tight limit on top of
    # the API's own.
    location ~ ^/api/(auth/(sign-in/email|two-factor/verify-(totp|backup-code)|request-password-reset|reset-password|reauthenticate)|invitations/(lookup|accept))$ {
        limit_req zone=mizansignin burst=5 nodelay;
        proxy_pass http://127.0.0.1:3300;
        include snippets/mizan-proxy.conf;
    }

    # Attachments of drafts and entries: up to 10 MB a file (ATTACHMENT_MAX_BYTES), with room for
    # the multipart envelope, streamed to the API as they arrive, with timeouts for slow links.
    # The proxy snippet sets its own read timeout, so its headers are repeated here.
    location ~ ^/api/(drafts|entries)/[^/]+/attachments$ {
        client_max_body_size 11m;
        client_body_timeout 120s;
        proxy_request_buffering off;
        proxy_pass http://127.0.0.1:3300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_hide_header X-Powered-By;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    # The API documentation is disabled in production; don't forward probes for it.
    location ^~ /api/docs { return 404; }

    # --- Hub's API (/v1, ADR 0006) -------------------------------------------------------
    # Its own zone instead of the site-wide one (mizan-limits.conf).
    location /v1/ {
        limit_req zone=mizanv1 burst=200 nodelay;
        proxy_pass http://127.0.0.1:3300;
        include snippets/mizan-proxy.conf;
    }

    # The opening snapshot (S10): up to 5 MB of JSON (OPENING_SNAPSHOT_MAX_BYTES), once per
    # company, with time to send and post it. The proxy snippet sets its own read timeout, so its
    # headers are repeated here.
    location = /v1/opening/snapshot {
        limit_req zone=mizanv1 burst=200 nodelay;
        client_max_body_size 6m;
        client_body_timeout 60s;
        proxy_pass http://127.0.0.1:3300;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_hide_header X-Powered-By;
        proxy_read_timeout 120s;
    }

    # --- Static files ----------------------------------------------------------------------
    # Hashed build assets never change: cache them for a year.
    location /assets/ {
        try_files $uri =404;
        # Replaces the server block's `limit_conn perip 100` here (mizan-limits.conf).
        limit_conn mizanassets 1000;
        include snippets/mizan-headers.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        access_log off;
    }

    # Dotfiles and source maps are never served.
    location ~ /\. { return 404; }
    location ~ \.map$ { return 404; }

    # The SPA: every other path renders index.html, which must always be revalidated so a
    # deploy takes effect on the next page load.
    location / {
        try_files $uri /index.html;
        include snippets/mizan-headers.conf;
        add_header Cache-Control "no-cache" always;
    }
}
